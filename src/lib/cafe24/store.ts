/**
 * 카페24 SpaceCredential 읽기·조건부 쓰기.
 * 버전 = config.credVersion(정수). 등록·콜백·갱신 세 경로만 올린다 — 무조건 upsert 는 쓰지 않는다.
 * 조건부 쓰기: updateMany where { id, provider, config.credVersion = 읽은 버전 } → 0행이면 false.
 */
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { decryptField, encryptField } from '@/lib/crypto/field-crypto'

export const PROVIDER = 'cafe24'

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
  secret: Cafe24Secret
  config: Cafe24Config
}

export async function readCafe24(spaceId: string): Promise<Cafe24Row | null> {
  const row = await prisma.spaceCredential.findUnique({
    where: { spaceId_provider: { spaceId, provider: PROVIDER } },
    select: { id: true, encryptedPayload: true, iv: true, config: true },
  })
  if (!row) return null
  const config = (row.config ?? {}) as Partial<Cafe24Config>
  return {
    id: row.id,
    secret: JSON.parse(
      decryptField('space-credential', row.encryptedPayload, row.iv)
    ) as Cafe24Secret,
    config: {
      ...config,
      mallId: config.mallId ?? '',
      credVersion: typeof config.credVersion === 'number' ? config.credVersion : 0,
      status: config.status ?? 'needs_auth',
    },
  }
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
      provider: PROVIDER,
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

/** 최초 등록. 동시 생성(@@unique 충돌)이면 false. */
export async function createCafe24(
  spaceId: string,
  secret: Cafe24Secret,
  config: Omit<Cafe24Config, 'credVersion'>
): Promise<boolean> {
  const { encrypted: encryptedPayload, iv } = enc(secret)
  try {
    await prisma.spaceCredential.create({
      data: {
        spaceId,
        provider: PROVIDER,
        encryptedPayload,
        iv,
        config: JSON.parse(JSON.stringify({ ...config, credVersion: 1 })) as Prisma.InputJsonValue,
      },
    })
    return true
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return false
    throw err
  }
}

/**
 * 앱 정보(쇼핑몰 ID·client_id·client_secret) 등록. 읽기 → 병합 → 조건부 쓰기, 충돌이면 'conflict'(409).
 * clientId·mallId 가 바뀌면 토큰·lease 를 버리고 승인 필요로 돌린다. 같은 값으로 시크릿만 바꾸면 토큰을 유지한다.
 */
export async function registerCafe24(
  spaceId: string,
  input: { clientId: string; clientSecret: string; mallId: string }
): Promise<'ok' | 'conflict'> {
  const { clientId, clientSecret, mallId } = input
  const cur = await readCafe24(spaceId)
  if (!cur) {
    const ok = await createCafe24(
      spaceId,
      { clientId, clientSecret },
      { mallId, status: 'needs_auth' }
    )
    return ok ? 'ok' : 'conflict'
  }
  const same = cur.secret.clientId === clientId && cur.config.mallId === mallId
  const ok = await writeCafe24If(
    cur,
    same ? { ...cur.secret, clientSecret } : { clientId, clientSecret },
    same ? cur.config : { mallId, status: 'needs_auth' },
    true
  )
  return ok ? 'ok' : 'conflict'
}
