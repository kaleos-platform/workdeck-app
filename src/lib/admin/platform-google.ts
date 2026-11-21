/**
 * 운영사(워크덱) 홈페이지 GA4 연동 자격증명 — PlatformCredential(공간 없음) 읽기·조건부 쓰기.
 * 버전 = config.credVersion(최초 create=1). 모든 쓰기는 감사 로그와 같은 Prisma transaction 이다
 * (감사 기록이 실패하면 변경도 롤백). 비밀값은 감사 meta·오류·로그 어디에도 넣지 않는다.
 */
import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { decryptField, encryptField } from '@/lib/crypto/field-crypto'
import { writeAuditLog } from '@/lib/admin/auth'
import { hasGoogleScopes, type GoogleSecret } from '@/lib/agent/integrations/google-marketing'

export const PLATFORM_PROVIDER = 'google-analytics-platform'
export const PLATFORM_STATE_PURPOSE = 'admin-google-analytics'
export const PLATFORM_NONCE_COOKIE = 'admin_google_oauth_nonce'
export const PLATFORM_COOKIE_PATH = '/api/admin/platform/google'
export const PLATFORM_CALLBACK_PATH = '/api/admin/platform/google/callback'
// 조회 전용 — 운영사 화면은 GA4 를 변경하지 않는다.
export const PLATFORM_SCOPES = ['https://www.googleapis.com/auth/analytics.readonly']

export type PlatformStatus = 'needs_auth' | 'needs_check' | 'connected'

export interface PlatformConfig {
  propertyId: string
  streamId: string
  status: PlatformStatus
  connectedAt?: string
  connectedBy?: string
  scopes?: string[]
  credVersion: number
}

export interface PlatformRow {
  id: string
  secret: GoogleSecret
  config: PlatformConfig
  lastError: string | null
}

export interface AuditSpec {
  actorUserId: string
  action: string
  meta?: Record<string, unknown>
}

export async function readPlatformGoogle(): Promise<PlatformRow | null> {
  const row = await prisma.platformCredential.findUnique({
    where: { provider: PLATFORM_PROVIDER },
    select: { id: true, encryptedPayload: true, iv: true, config: true, lastError: true },
  })
  if (!row) return null
  const config = (row.config ?? {}) as Partial<PlatformConfig>
  return {
    id: row.id,
    lastError: row.lastError,
    secret: JSON.parse(
      decryptField('platform-credential', row.encryptedPayload, row.iv)
    ) as GoogleSecret,
    config: {
      propertyId: config.propertyId ?? '',
      streamId: config.streamId ?? '',
      status: config.status ?? 'needs_auth',
      ...(config.connectedAt ? { connectedAt: config.connectedAt } : {}),
      ...(config.connectedBy ? { connectedBy: config.connectedBy } : {}),
      ...(config.scopes ? { scopes: config.scopes } : {}),
      credVersion: typeof config.credVersion === 'number' ? config.credVersion : 0,
    },
  }
}

const enc = (secret: GoogleSecret) => encryptField('platform-credential', JSON.stringify(secret))
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue

/** 읽은 버전과 같을 때만 쓰고 버전을 1 올린다(+ 감사 로그, 같은 transaction). 0행이면 false. */
export async function writePlatformGoogleIf(
  current: PlatformRow,
  secret: GoogleSecret,
  config: Omit<PlatformConfig, 'credVersion'>,
  audit: AuditSpec,
  clearError = true
): Promise<boolean> {
  const { encrypted: encryptedPayload, iv } = enc(secret)
  const version = current.config.credVersion
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.platformCredential.updateMany({
      where: {
        id: current.id,
        provider: PLATFORM_PROVIDER,
        config: { path: ['credVersion'], equals: version },
      },
      data: {
        encryptedPayload,
        iv,
        config: json({ ...config, credVersion: version + 1 }),
        ...(clearError ? { lastError: null } : {}),
      },
    })
    if (count !== 1) return false
    await writeAuditLog(
      audit.actorUserId,
      audit.action,
      'platformCredential',
      current.id,
      audit.meta,
      tx
    )
    return true
  })
}

/** 최초 등록. 동시 생성(unique 충돌)이면 false. */
export async function createPlatformGoogle(
  secret: GoogleSecret,
  config: Omit<PlatformConfig, 'credVersion'>,
  audit: AuditSpec
): Promise<boolean> {
  const { encrypted: encryptedPayload, iv } = enc(secret)
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.platformCredential.create({
        data: {
          provider: PLATFORM_PROVIDER,
          encryptedPayload,
          iv,
          config: json({ ...config, credVersion: 1 }),
        },
        select: { id: true },
      })
      await writeAuditLog(
        audit.actorUserId,
        audit.action,
        'platformCredential',
        created.id,
        audit.meta,
        tx
      )
    })
    return true
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return false
    throw err
  }
}

/** 오류는 lastError 에 한 줄만(허용 코드가 든 GoogleOAuthError 메시지) 남긴다. */
export async function recordPlatformError(id: string, message: string): Promise<void> {
  await prisma.platformCredential.update({
    where: { id },
    data: { lastError: message.slice(0, 300) },
  })
}

export interface RegisterInput {
  clientId: string
  /** 비우면 같은 clientId 일 때 기존 값을 유지한다. */
  clientSecret?: string
  propertyId: string
  streamId: string
}

/**
 * 저장(PUT). 같은 clientId 면 refresh token 유지·다르면 제거, 속성/스트림이 바뀌면 needs_check.
 * 조건부 쓰기가 0행이면 'conflict'(409). 시크릿이 필요한데 없으면 'secret_required'.
 */
export async function registerPlatformGoogle(
  input: RegisterInput,
  operatorId: string
): Promise<'ok' | 'conflict' | 'secret_required'> {
  const cur = await readPlatformGoogle()
  const sameClient = cur?.secret.clientId === input.clientId
  const clientSecret = input.clientSecret || (sameClient ? cur?.secret.clientSecret : undefined)
  if (!clientSecret) return 'secret_required'
  const refreshToken = sameClient ? cur?.secret.refreshToken : undefined
  const secret: GoogleSecret = {
    clientId: input.clientId,
    clientSecret,
    ...(refreshToken ? { refreshToken } : {}),
  }
  const base = { propertyId: input.propertyId, streamId: input.streamId }
  const keep = sameClient ? cur : null
  const targetChanged =
    !keep || keep.config.propertyId !== base.propertyId || keep.config.streamId !== base.streamId
  let config: Omit<PlatformConfig, 'credVersion'>
  if (!refreshToken) {
    config = { ...base, status: 'needs_auth' }
  } else if (!hasGoogleScopes(keep?.config.scopes, PLATFORM_SCOPES)) {
    config = {
      ...base,
      status: 'needs_auth',
      ...(keep?.config.scopes ? { scopes: keep.config.scopes } : {}),
    }
  } else if (targetChanged || keep?.config.status === 'needs_auth') {
    config = { ...base, status: 'needs_check', scopes: keep?.config.scopes }
  } else {
    config = {
      ...base,
      status: keep!.config.status,
      ...(keep!.config.connectedAt ? { connectedAt: keep!.config.connectedAt } : {}),
      ...(keep!.config.connectedBy ? { connectedBy: keep!.config.connectedBy } : {}),
      scopes: keep!.config.scopes,
    }
  }
  const audit: AuditSpec = {
    actorUserId: operatorId,
    action: 'platform.google.save',
    // 비밀값·clientId 는 넣지 않는다.
    meta: {
      propertyId: base.propertyId,
      streamId: base.streamId,
      clientChanged: !sameClient,
      status: config.status,
    },
  }
  const ok = cur
    ? await writePlatformGoogleIf(cur, secret, config, audit)
    : await createPlatformGoogle(secret, config, audit)
  return ok ? 'ok' : 'conflict'
}
