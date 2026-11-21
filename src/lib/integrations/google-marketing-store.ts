/**
 * 구글 마케팅 SpaceCredential 읽기·조건부 쓰기(카페24 store.ts 와 같은 방식).
 * 버전 = config.credVersion(정수). 등록(저장)·콜백·health 승격 세 경로만 올린다 — 무조건 upsert 는 쓰지 않는다.
 * 조건부 쓰기: updateMany where { id, provider, config.credVersion = 읽은 버전 } → 0행이면 false.
 * 수동 토큰 시절의 기존 행은 credVersion 키가 없다 → 0 으로 읽고, 0 이면 「키 없음」 조건(IS NULL)으로 건다
 * (JSON path `equals: 0` 은 키 없는 행과 맞지 않는다 — store.e2e.test 로 dev DB 에서 확인).
 */
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { decryptField, encryptField } from '@/lib/crypto/field-crypto'
import {
  PROVIDER,
  hasGoogleScopes,
  requiredGoogleScopes,
  type GoogleConfig,
  type GoogleSecret,
} from '@/lib/agent/integrations/google-marketing'

export interface GoogleRow {
  id: string
  secret: GoogleSecret
  /** credVersion 은 항상 숫자(키 없으면 0). status 는 기존 행이면 undefined. */
  config: GoogleConfig & { credVersion: number }
}

export async function readGoogle(spaceId: string): Promise<GoogleRow | null> {
  const row = await prisma.spaceCredential.findUnique({
    where: { spaceId_provider: { spaceId, provider: PROVIDER } },
    select: { id: true, encryptedPayload: true, iv: true, config: true },
  })
  if (!row) return null
  const config = (row.config ?? {}) as Partial<GoogleConfig>
  return {
    id: row.id,
    secret: JSON.parse(
      decryptField('space-credential', row.encryptedPayload, row.iv)
    ) as GoogleSecret,
    config: {
      ...config,
      brands: config.brands ?? {},
      credVersion: typeof config.credVersion === 'number' ? config.credVersion : 0,
    },
  }
}

const enc = (secret: GoogleSecret) => encryptField('space-credential', JSON.stringify(secret))
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue

/** 읽은 버전과 같을 때만 쓰고 버전을 1 올린다. 0(키 없음)은 IS NULL 조건. clearError 면 lastError 도 비운다. */
export async function writeGoogleIf(
  current: GoogleRow,
  secret: GoogleSecret,
  config: Omit<GoogleConfig, 'credVersion'>,
  clearError = false
): Promise<boolean> {
  const { encrypted: encryptedPayload, iv } = enc(secret)
  const version = current.config.credVersion
  const { count } = await prisma.spaceCredential.updateMany({
    where: {
      id: current.id,
      provider: PROVIDER,
      config:
        version === 0
          ? { path: ['credVersion'], equals: Prisma.DbNull }
          : { path: ['credVersion'], equals: version },
    },
    data: {
      encryptedPayload,
      iv,
      config: json({ ...config, credVersion: version + 1 }),
      ...(clearError ? { lastError: null } : {}),
    },
  })
  return count === 1
}

/** 최초 등록. 동시 생성(@@unique 충돌)이면 false. */
export async function createGoogle(
  spaceId: string,
  secret: GoogleSecret,
  config: Omit<GoogleConfig, 'credVersion'>
): Promise<boolean> {
  const { encrypted: encryptedPayload, iv } = enc(secret)
  try {
    await prisma.spaceCredential.create({
      data: {
        spaceId,
        provider: PROVIDER,
        encryptedPayload,
        iv,
        config: json({ ...config, credVersion: 1 }),
      },
    })
    return true
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return false
    throw err
  }
}

const propertyKey = (c: Pick<GoogleConfig, 'brands'>) =>
  JSON.stringify(
    Object.entries(c.brands ?? {})
      .map(([b, v]) => [b, v.ga4_property_id])
      .sort()
  )

/**
 * 저장(PUT). 읽기 → 병합 → 조건부 쓰기, 충돌이면 'conflict'(409).
 * refresh token: 값이 오면 그대로, 안 오면 같은 clientId 일 때만 기존 값을 유지한다.
 * 상태는 서버가 계산한다(입력으로 받지 않는다):
 *  - 토큰 없음 → needs_auth / 저장된 scopes 가 새 필수 범위에 못 미침 → needs_auth(토큰은 남김)
 *  - 새로 받은 토큰·브랜드 속성 변경·승인 부족이 해소된 경우 → needs_check(다음 health 가 확인·승격)
 *  - scopes 를 모르는 기존 수동 토큰(status 없음)은 속성이 안 바뀌면 그대로 둔다(강등 안 함).
 */
export async function registerGoogle(
  spaceId: string,
  input: {
    clientId: string
    clientSecret: string
    refreshToken?: string
    config: Pick<GoogleConfig, 'defaultBrand' | 'brands'>
  }
): Promise<'ok' | 'conflict'> {
  const cur = await readGoogle(spaceId)
  const sameClient = cur?.secret.clientId === input.clientId
  const provided = input.refreshToken !== undefined
  const refreshToken = provided
    ? input.refreshToken
    : sameClient
      ? cur?.secret.refreshToken
      : undefined
  const secret: GoogleSecret = {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    ...(refreshToken ? { refreshToken } : {}),
  }
  const keep = sameClient && !provided ? cur : null // 기존 상태·scopes 를 이어받는 경우
  const base = { defaultBrand: input.config.defaultBrand, brands: input.config.brands }
  let config: Omit<GoogleConfig, 'credVersion'>
  if (!refreshToken) {
    config = { ...base, status: 'needs_auth' }
  } else if (
    keep?.config.scopes &&
    !hasGoogleScopes(keep.config.scopes, requiredGoogleScopes(base))
  ) {
    config = { ...base, status: 'needs_auth', scopes: keep.config.scopes }
  } else if (
    !keep ||
    propertyKey(keep.config) !== propertyKey(base) ||
    keep.config.status === 'needs_auth'
  ) {
    config = {
      ...base,
      status: 'needs_check',
      ...(keep?.config.scopes ? { scopes: keep.config.scopes } : {}),
    }
  } else {
    config = {
      ...base,
      ...(keep.config.status ? { status: keep.config.status } : {}),
      ...(keep.config.connectedAt ? { connectedAt: keep.config.connectedAt } : {}),
      ...(keep.config.scopes ? { scopes: keep.config.scopes } : {}),
    }
  }
  if (!cur) return (await createGoogle(spaceId, secret, config)) ? 'ok' : 'conflict'
  return (await writeGoogleIf(cur, secret, config, true)) ? 'ok' : 'conflict'
}
