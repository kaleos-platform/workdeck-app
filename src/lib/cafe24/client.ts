/**
 * 카페24 Admin API 클라이언트 — OAuth 토큰 교환·갱신, 조회.
 * 비밀값 규칙: 토큰·응답 본문·요청 헤더(Basic·Bearer)는 오류·로그·DB·Slack 어디에도 넣지 않는다.
 * 오류는 Cafe24Error(단계명 + HTTP 상태 + 허용 목록의 error 코드)만 던진다. maskSecrets 에 의존하지 않는다.
 * 갱신 토큰은 회전한다(이전 것 폐기). DB 트랜잭션·락을 외부 HTTP 동안 잡지 않고,
 * 설정 안의 refreshLease + 조건부 쓰기(credVersion)로 동시 갱신을 막는다(store.ts).
 * 알려진 한계: 카페24가 옛 갱신 토큰을 폐기한 뒤 응답 유실·함수 종료·DB 저장 실패가 나면 복구 불가 → reauth_required(재승인).
 */
import crypto from 'node:crypto'
import { recordCredentialError } from '@/lib/agent/integrations/space-credential'
import { sendSpaceNotification } from '@/lib/slack/send-notification'
import { readCafe24, writeCafe24If, type Cafe24Row } from './store'

export const CAFE24_SCOPE = 'mall.read_order mall.write_order' // 공백 구분
export const CAFE24_API_VERSION = '2026-09-01'
export const MALL_ID_RE = /^[a-z0-9][a-z0-9-]{1,49}$/

const TOKEN_TIMEOUT_MS = 8000
const API_TIMEOUT_MS = 15000
const EXPIRY_LEAD_MS = 5 * 60 * 1000
const LEASE_MS = 20_000
const POLL_MS = 500
const WAIT_MAX_MS = 20_000
const ACCESS_TTL_MS = 2 * 60 * 60 * 1000
const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000

const KNOWN_CODES = new Set([
  'invalid_grant',
  'invalid_client',
  'invalid_request',
  'unauthorized_client',
  'insufficient_scope',
  'invalid_scope',
  'rate_limited',
  'unauthorized',
  'forbidden',
  'server_error',
])

export class Cafe24Error extends Error {
  constructor(
    readonly stage: string,
    readonly code: string,
    readonly status?: number
  ) {
    super(`카페24 ${stage} 실패${status ? ` (HTTP ${status})` : ''}: ${code}`)
    this.name = 'Cafe24Error'
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export interface Cafe24Tokens {
  accessToken: string
  refreshToken: string
  accessExpiresAt: string
  refreshExpiresAt: string
  mallId: string | null
  scopes: string[]
}

function hostOf(mallId: string): string {
  if (!MALL_ID_RE.test(mallId)) throw new Cafe24Error('config', 'invalid_mall_id')
  return `https://${mallId}.cafe24api.com`
}

export function authorizeUrl(mallId: string, clientId: string, state: string, redirectUri: string) {
  const url = new URL(`${hostOf(mallId)}/api/v2/oauth/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('state', state)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', CAFE24_SCOPE)
  return url.toString()
}

async function http(stage: string, url: string, init: RequestInit, timeoutMs: number) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch {
    throw new Cafe24Error(stage, 'network') // 원 오류 메시지는 버린다
  }
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  if (typeof body?.error === 'string' && KNOWN_CODES.has(body.error)) return body.error
  if (res.status === 401) return 'unauthorized'
  if (res.status === 403) return 'forbidden'
  if (res.status === 429) return 'rate_limited'
  return res.status >= 500 ? 'server_error' : 'unknown'
}

/** 카페24 시각(타임존 없으면 KST)을 읽고, 기대 범위를 벗어나면 fallback 을 쓴다. */
function expiry(value: unknown, fallbackMs: number, maxMs: number): string {
  const now = Date.now()
  if (typeof value === 'string') {
    const t = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}+09:00`)
    if (t > now && t <= now + maxMs) return new Date(t).toISOString()
  }
  return new Date(now + fallbackMs).toISOString()
}

function parseTokens(body: unknown, stage: string): Cafe24Tokens {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.access_token !== 'string' || typeof b.refresh_token !== 'string') {
    throw new Cafe24Error(stage, 'invalid_response')
  }
  const scopes = Array.isArray(b.scopes)
    ? b.scopes.filter((s): s is string => typeof s === 'string')
    : typeof b.scopes === 'string'
      ? b.scopes.split(/[\s,]+/).filter(Boolean)
      : []
  return {
    accessToken: b.access_token,
    refreshToken: b.refresh_token,
    accessExpiresAt: expiry(b.expires_at, ACCESS_TTL_MS, ACCESS_TTL_MS + 60 * 60 * 1000),
    refreshExpiresAt: expiry(
      b.refresh_token_expires_at,
      REFRESH_TTL_MS,
      REFRESH_TTL_MS + 24 * 60 * 60 * 1000
    ),
    mallId: typeof b.mall_id === 'string' ? b.mall_id : null,
    scopes,
  }
}

async function tokenRequest(
  stage: string,
  mallId: string,
  clientId: string,
  clientSecret: string,
  params: Record<string, string>
): Promise<Cafe24Tokens> {
  const res = await http(
    stage,
    `${hostOf(mallId)}/api/v2/oauth/token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    },
    TOKEN_TIMEOUT_MS
  )
  if (!res.ok) throw new Cafe24Error(stage, await errorCode(res), res.status)
  return parseTokens(await res.json().catch(() => null), stage)
}

export function exchangeCode(
  mallId: string,
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
) {
  return tokenRequest('code-exchange', mallId, clientId, clientSecret, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  })
}

export function refreshTokens(
  mallId: string,
  clientId: string,
  clientSecret: string,
  refreshToken: string
) {
  return tokenRequest('token-refresh', mallId, clientId, clientSecret, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
}

/** scope 표기가 문서마다 달라(mall.read_order / read_order / READ_ORDER) 정규화해 비교한다. */
export function hasOrderScopes(scopes: string[]): boolean {
  const n = new Set(scopes.map((s) => s.toLowerCase().replace(/^mall\./, '')))
  return n.has('read_order') && n.has('write_order')
}

async function markReauthRequired(cur: Cafe24Row, spaceId: string): Promise<void> {
  const changed = cur.config.status !== 'reauth_required'
  await writeCafe24If(cur, cur.secret, {
    ...cur.config,
    status: 'reauth_required',
    refreshLease: undefined,
  }).catch(() => false)
  await recordCredentialError(
    cur.id,
    '카페24 승인이 만료되었습니다. 연결 팝업에서 다시 승인해 주세요'
  )
  if (changed) {
    await sendSpaceNotification({
      spaceId,
      text: ':warning: 카페24 연결이 끊어졌습니다. 설정 > 외부 서비스 연결 > 카페24에서 다시 승인해 주세요.',
    }).catch(() => false)
  }
}

async function releaseLease(spaceId: string, owner: string): Promise<void> {
  try {
    const cur = await readCafe24(spaceId)
    if (cur?.config.refreshLease?.owner === owner) {
      await writeCafe24If(cur, cur.secret, { ...cur.config, refreshLease: undefined })
    }
  } catch {
    // 해제 실패는 lease 만료(20초)로 풀린다.
  }
}

export interface Cafe24Access {
  accessToken: string
  mallId: string
  credentialId: string
}

/** lease 를 잡은 채 갱신한다. null = 다시 읽어서 판단(다른 실행이 회전했거나 설정이 바뀜). */
async function refreshHoldingLease(
  spaceId: string,
  owner: string,
  base: Cafe24Row
): Promise<Cafe24Access | null> {
  const { clientId, clientSecret } = base.secret
  const r0 = base.secret.refreshToken as string
  const mallId = base.config.mallId

  let tokens: Cafe24Tokens
  try {
    tokens = await refreshTokens(mallId, clientId, clientSecret, r0)
  } catch (err) {
    if (err instanceof Cafe24Error && err.code === 'invalid_grant') {
      const cur = await readCafe24(spaceId)
      if (!cur) throw err
      const lease = cur.config.refreshLease
      const changed =
        cur.secret.refreshToken !== r0 ||
        cur.secret.clientId !== clientId ||
        cur.config.mallId !== mallId
      // lease 밖에서 회전됐거나 유효한 다른 lease 가 있으면 실패로 확정하지 않는다.
      if (changed || (lease && lease.owner !== owner && lease.until > Date.now())) return null
      await markReauthRequired(cur, spaceId)
      throw new Cafe24Error('token', 'reauth_required')
    }
    await releaseLease(spaceId, owner)
    throw err
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await readCafe24(spaceId)
    // (a) 재설정 (b) 다른 실행이 회전 → 내 토큰을 버리고 저장된 상태를 따른다.
    if (
      !cur ||
      cur.secret.clientId !== clientId ||
      cur.config.mallId !== mallId ||
      cur.secret.refreshToken !== r0
    ) {
      return null
    }
    const lease = cur.config.refreshLease
    const ok = await writeCafe24If(
      cur,
      { ...cur.secret, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
      {
        ...cur.config,
        accessExpiresAt: tokens.accessExpiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
        refreshLease: lease?.owner === owner ? undefined : lease,
      }
    )
    // (c) 토큰과 무관한 변경으로 0행 → 최신 버전에 다시 병합
    if (ok) return { accessToken: tokens.accessToken, mallId, credentialId: cur.id }
  }
  const last = await readCafe24(spaceId)
  if (last) await markReauthRequired(last, spaceId)
  throw new Cafe24Error('token', 'reauth_required')
}

/**
 * 유효한 액세스 토큰을 돌려준다. 만료 5분 전이면 갱신한다.
 * rejectedToken: 401 을 받은 토큰 — 저장된 값이 이것이면 만료 전이어도 갱신한다.
 * 던지는 code: not_configured·not_authorized(승인 전)·reauth_required(갱신 토큰 사망)·lease_timeout.
 */
export async function getAccessToken(
  spaceId: string,
  opts: { rejectedToken?: string } = {}
): Promise<Cafe24Access> {
  const owner = crypto.randomUUID()
  let waitedSince: number | null = null
  for (let i = 0; i < 60; i++) {
    const row = await readCafe24(spaceId)
    if (!row) throw new Cafe24Error('token', 'not_configured')
    const { secret, config } = row
    if (!secret.refreshToken) throw new Cafe24Error('token', 'not_authorized')
    if (config.status === 'reauth_required') throw new Cafe24Error('token', 'reauth_required')
    if (
      secret.accessToken &&
      secret.accessToken !== opts.rejectedToken &&
      Date.parse(config.accessExpiresAt ?? '') - Date.now() > EXPIRY_LEAD_MS
    ) {
      return { accessToken: secret.accessToken, mallId: config.mallId, credentialId: row.id }
    }
    const lease = config.refreshLease
    if (lease && lease.until > Date.now() && lease.owner !== owner) {
      waitedSince ??= Date.now()
      if (Date.now() - waitedSince > WAIT_MAX_MS) throw new Cafe24Error('token', 'lease_timeout')
      await sleep(POLL_MS)
      continue
    }
    const leased = await writeCafe24If(row, secret, {
      ...config,
      refreshLease: { owner, until: Date.now() + LEASE_MS },
    })
    if (!leased) continue
    const result = await refreshHoldingLease(spaceId, owner, row)
    if (result) return result
  }
  throw new Cafe24Error('token', 'lease_timeout')
}

/** 조회 전용 GET(/api/v2 아래). 응답 JSON 을 돌려주며, 실패는 Cafe24Error 만 던진다. */
export async function cafe24Get(
  spaceId: string,
  path: string,
  query: Record<string, string | number> = {}
): Promise<unknown> {
  let rejected: string | undefined
  let retried401 = false
  let rateTries = 0
  for (;;) {
    const { accessToken, mallId } = await getAccessToken(spaceId, { rejectedToken: rejected })
    const url = new URL(`${hostOf(mallId)}/api/v2${path}`)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))
    const res = await http(
      'api',
      url.toString(),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Cafe24-Api-Version': CAFE24_API_VERSION,
        },
      },
      API_TIMEOUT_MS
    )
    if (res.status === 401 && !retried401) {
      retried401 = true
      rejected = accessToken
      continue
    }
    if (res.status === 429 && rateTries < 3) {
      await sleep(1000 * 2 ** rateTries++)
      continue
    }
    if (!res.ok) throw new Cafe24Error('api', await errorCode(res), res.status)
    // 호출 제한 버킷(사용/40)이 차오르면 잠시 쉰다.
    if (Number(res.headers.get('X-Api-Call-Limit')?.split('/')[0]) >= 30) await sleep(1000)
    return res.json().catch(() => {
      throw new Cafe24Error('api', 'invalid_response', res.status)
    })
  }
}

/** 최근 1일 주문 목록 1건 조회 — 연결·권한이 실제로 동작하는지 확인한다. */
export async function probeOrders(spaceId: string): Promise<void> {
  const day = (offsetDays: number) =>
    new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10)
  await cafe24Get(spaceId, '/admin/orders', { start_date: day(1), end_date: day(0), limit: 1 })
}
