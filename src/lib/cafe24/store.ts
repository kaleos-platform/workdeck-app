/**
 * 카페24 SpaceCredential 읽기·조건부 쓰기.
 * 버전 = config.credVersion(정수). 등록·콜백·갱신 세 경로만 올린다 — 무조건 upsert 는 쓰지 않는다.
 * 조건부 쓰기: updateMany where { id, provider, config.credVersion = 읽은 버전 } → 0행이면 false.
 * 쇼핑몰 행 = provider `cafe24:<mallId>` 새 행 + 레거시 provider `cafe24` 행(config.mallId 로 식별, 이전하지 않는다).
 * 모든 쓰기는 읽은 행의 provider·id 로 한다. 같은 mallId 로 행이 둘 생기지 않게 등록은 Space 단위 advisory 잠금 트랜잭션.
 */
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { decryptField, encryptField } from '@/lib/crypto/field-crypto'

/** 레거시(이전하지 않는) 쇼핑몰 행의 provider. */
export const PROVIDER = 'cafe24'
export const MAX_MALLS = 5
export const cafe24Provider = (mallId: string) => `${PROVIDER}:${mallId}`

export interface Cafe24Secret {
  clientId: string
  clientSecret: string
  accessToken?: string
  refreshToken?: string
}

export type Cafe24Status = 'needs_auth' | 'connected' | 'reauth_required'

export interface Cafe24Config {
  mallId: string
  credVersion: number
  status: Cafe24Status
  accessExpiresAt?: string
  refreshExpiresAt?: string
  scopes?: string[]
  connectedAt?: string
  connectedBy?: string
  refreshLease?: { owner: string; until: number }
}

export interface Cafe24Row {
  id: string
  /** 읽은 행의 provider — 쓰기는 항상 이 값으로 한다(레거시 `cafe24` 또는 `cafe24:<mallId>`). */
  provider: string
  secret: Cafe24Secret
  config: Cafe24Config
}

const CAFE24_WHERE = (spaceId: string) => ({
  spaceId,
  OR: [{ provider: PROVIDER }, { provider: { startsWith: `${PROVIDER}:` } }],
})

type RawRow = {
  id: string
  provider: string
  encryptedPayload: string
  iv: string
  config: unknown
}
const RAW_SELECT = {
  id: true,
  provider: true,
  encryptedPayload: true,
  iv: true,
  config: true,
} as const

function normConfig(raw: unknown): Cafe24Config {
  const config = (raw ?? {}) as Partial<Cafe24Config>
  return {
    ...config,
    mallId: config.mallId ?? '',
    credVersion: typeof config.credVersion === 'number' ? config.credVersion : 0,
    status: config.status ?? 'needs_auth',
  }
}

function toRow(row: RawRow): Cafe24Row {
  return {
    id: row.id,
    provider: row.provider,
    secret: JSON.parse(
      decryptField('space-credential', row.encryptedPayload, row.iv)
    ) as Cafe24Secret,
    config: normConfig(row.config),
  }
}

/** 레거시 `cafe24` 행(호환용: storeKey 가 null 인 관측 채널·옛 연동). */
export async function readLegacyCafe24(spaceId: string): Promise<Cafe24Row | null> {
  const row = await prisma.spaceCredential.findUnique({
    where: { spaceId_provider: { spaceId, provider: PROVIDER } },
    select: RAW_SELECT,
  })
  return row ? toRow(row) : null
}

/** 그 쇼핑몰의 행: `cafe24:<mallId>` 우선, 없으면 레거시 행 중 config.mallId 가 같은 것. mallId null = 레거시 행. */
export async function readCafe24(
  spaceId: string,
  mallId: string | null
): Promise<Cafe24Row | null> {
  if (mallId === null) return readLegacyCafe24(spaceId)
  const row = await prisma.spaceCredential.findUnique({
    where: { spaceId_provider: { spaceId, provider: cafe24Provider(mallId) } },
    select: RAW_SELECT,
  })
  if (row) return toRow(row)
  const legacy = await readLegacyCafe24(spaceId)
  return legacy?.config.mallId === mallId ? legacy : null
}

/** 레거시 행의 mallId(복호화 없이 config 만). 없으면 null. */
export async function legacyMallId(spaceId: string): Promise<string | null> {
  const row = await prisma.spaceCredential.findUnique({
    where: { spaceId_provider: { spaceId, provider: PROVIDER } },
    select: { config: true },
  })
  return (row?.config as Partial<Cafe24Config> | null)?.mallId ?? null
}

export interface Cafe24MallInfo {
  mallId: string
  config: Cafe24Config
  error: string | null
}

/** 쇼핑몰 목록(레거시 포함, mallId 오름차순). 복호화하지 않고 config·오류 문구만 읽는다. */
export async function listCafe24Malls(spaceId: string): Promise<Cafe24MallInfo[]> {
  const rows = await prisma.spaceCredential.findMany({
    where: CAFE24_WHERE(spaceId),
    select: { config: true, lastError: true, healthError: true },
  })
  return rows
    .map((r) => {
      const config = normConfig(r.config)
      return { mallId: config.mallId, config, error: r.healthError ?? r.lastError ?? null }
    })
    .filter((m) => m.mallId)
    .sort((a, b) => a.mallId.localeCompare(b.mallId))
}

const enc = (secret: Cafe24Secret) => encryptField('space-credential', JSON.stringify(secret))

/** 읽은 버전과 같을 때만 쓰고 버전을 1 올린다. clearError 면 lastError 도 비운다. */
export async function writeCafe24If(
  current: Cafe24Row,
  secret: Cafe24Secret,
  config: Omit<Cafe24Config, 'credVersion'>,
  clearError = false
): Promise<boolean> {
  const { encrypted: encryptedPayload, iv } = enc(secret)
  const next = { ...config, credVersion: current.config.credVersion + 1 }
  const { count } = await prisma.spaceCredential.updateMany({
    where: {
      id: current.id,
      provider: current.provider,
      config: { path: ['credVersion'], equals: current.config.credVersion },
    },
    data: {
      encryptedPayload,
      iv,
      config: JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue,
      ...(clearError ? { lastError: null } : {}),
    },
  })
  return count === 1
}

/** 최초 등록(`cafe24:<mallId>` 행). 동시 생성(@@unique 충돌)이면 false. */
export async function createCafe24(
  spaceId: string,
  mallId: string,
  secret: Cafe24Secret,
  config: Omit<Cafe24Config, 'credVersion' | 'mallId'>
): Promise<boolean> {
  const { encrypted: encryptedPayload, iv } = enc(secret)
  try {
    await prisma.spaceCredential.create({
      data: {
        spaceId,
        provider: cafe24Provider(mallId),
        encryptedPayload,
        iv,
        config: JSON.parse(
          JSON.stringify({ ...config, mallId, credVersion: 1 })
        ) as Prisma.InputJsonValue,
      },
    })
    return true
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return false
    throw err
  }
}

class Conflict extends Error {}

/** Space 단위 직렬화 — 추가·앱 정보 전파·삭제가 같은 잠금을 쓴다(갱신은 쓰지 않는다: 외부 HTTP 동안 잠금 금지). */
const lockSpace = (tx: Prisma.TransactionClient, spaceId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cafe24:${spaceId}`}))`

export type RegisterResult = 'ok' | 'conflict' | 'limit' | 'app_required' | 'no_malls'

/**
 * 쇼핑몰 추가·앱 정보 갱신. 한 트랜잭션(Space 잠금)에서 처리한다.
 * - mallId 있음: 새 몰이면 행 생성(한도 5, 레거시 포함). 앱 정보가 없으면 기존 몰 행에서 복사(첫 몰은 필수 → 'app_required').
 * - mallId 없음: 앱 정보만 수정(몰이 없으면 'no_malls').
 * 앱 정보가 있으면 모든 행을 credVersion 조건부 updateMany 로 갱신하고, 하나라도 0행이면 전체 롤백 → 'conflict'.
 * clientId 가 바뀐 행은 토큰·lease 를 버리고 승인 필요로 돌린다. secret 만 바뀌면 토큰을 유지한다.
 */
export async function registerCafe24(
  spaceId: string,
  input: { mallId?: string; clientId?: string; clientSecret?: string }
): Promise<RegisterResult> {
  const { mallId, clientId, clientSecret } = input
  const app = clientId && clientSecret ? { clientId, clientSecret } : null
  try {
    return await prisma.$transaction(async (tx) => {
      await lockSpace(tx, spaceId)
      const rows = (
        await tx.spaceCredential.findMany({ where: CAFE24_WHERE(spaceId), select: RAW_SELECT })
      ).map(toRow)
      if (mallId === undefined && rows.length === 0) return 'no_malls'
      const exists = mallId !== undefined && rows.some((r) => r.config.mallId === mallId)
      if (mallId !== undefined && !exists && rows.length >= MAX_MALLS) return 'limit'
      const useApp =
        app ??
        (rows[0] && {
          clientId: rows[0].secret.clientId,
          clientSecret: rows[0].secret.clientSecret,
        })
      if (!useApp) return 'app_required'

      if (app) {
        for (const r of rows) {
          const same = r.secret.clientId === app.clientId
          const { encrypted: encryptedPayload, iv } = enc(
            same ? { ...r.secret, clientSecret: app.clientSecret } : app
          )
          const next = {
            ...(same ? r.config : { mallId: r.config.mallId, status: 'needs_auth' }),
            credVersion: r.config.credVersion + 1,
          }
          const { count } = await tx.spaceCredential.updateMany({
            where: {
              id: r.id,
              provider: r.provider,
              config: { path: ['credVersion'], equals: r.config.credVersion },
            },
            data: {
              encryptedPayload,
              iv,
              config: JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue,
              // 앱이 바뀐 행은 예전 오류·점검 상태를 비운다(승인 필요로 새 출발). 같은 앱이면 오류 안내를 유지.
              ...(same ? {} : { lastError: null, healthError: null, healthAlertedAt: null }),
            },
          })
          if (count !== 1) throw new Conflict()
        }
      }
      if (mallId !== undefined && !exists) {
        const { encrypted: encryptedPayload, iv } = enc(useApp)
        await tx.spaceCredential.create({
          data: {
            spaceId,
            provider: cafe24Provider(mallId),
            encryptedPayload,
            iv,
            config: { mallId, status: 'needs_auth', credVersion: 1 },
          },
        })
      }
      return 'ok'
    })
  } catch (err) {
    if (err instanceof Conflict || (err as { code?: string }).code === 'P2002') return 'conflict'
    throw err
  }
}

/**
 * 쇼핑몰 삭제(Space 잠금). 관측이 켜진 채널이 그 몰을 쓰면 'in_use'
 * (storeKey null 은 레거시 행의 mallId 로 해석). 없으면 'not_found'.
 * ponytail: 켜기(order-observe PUT)와의 교차 경합은 막지 못한다 — 삭제된 몰의 채널은 관측이 auth_error 로 보인다.
 */
export async function deleteCafe24(
  spaceId: string,
  mallId: string
): Promise<'ok' | 'in_use' | 'not_found'> {
  return prisma.$transaction(async (tx) => {
    await lockSpace(tx, spaceId)
    const rows = await tx.spaceCredential.findMany({
      where: CAFE24_WHERE(spaceId),
      select: { id: true, provider: true, config: true },
    })
    const target = rows.find((r) => normConfig(r.config).mallId === mallId)
    if (!target) return 'not_found'
    const legacy = rows.find((r) => r.provider === PROVIDER)
    const legacyId = legacy ? normConfig(legacy.config).mallId : null
    const observing = await tx.channelFulfillmentSetting.findMany({
      where: { spaceId, adapter: 'cafe24', observeEnabled: true },
      select: { storeKey: true },
    })
    if (observing.some((s) => (s.storeKey ?? legacyId) === mallId)) return 'in_use'
    await tx.spaceCredential.delete({ where: { id: target.id } })
    return 'ok'
  })
}
