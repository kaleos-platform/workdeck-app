/**
 * OAuth state 서명 + 일회용 nonce — 목적(purpose)별 공용.
 * state = base64url(JSON{spaceId,userId,clientId,nonceHash,exp}) + "." + base64url(HMAC-SHA256).
 * 키는 SLACK_SIGNING_SECRET 에서 목적을 넣어 도메인 분리 파생(HMAC(secret, '<purpose>-oauth-state:v1'))
 * — Slack·카페24 등 다른 목적의 state 와 서로 못 쓴다.
 * nonce 원문은 install 이 httpOnly 쿠키에만 넣고 state 에는 해시만 넣는다 → callback 이 쿠키와 대조한다.
 */
import crypto from 'node:crypto'

export const OAUTH_STATE_TTL_SEC = 10 * 60

export interface OAuthStatePayload {
  spaceId: string
  userId: string
  clientId: string
  nonceHash: string
  exp: number // epoch ms
}

function stateKey(purpose: string): Buffer | null {
  const secret = process.env.SLACK_SIGNING_SECRET
  if (!secret) return null
  return crypto.createHmac('sha256', secret).update(`${purpose}-oauth-state:v1`).digest()
}

const b64url = (buf: Buffer) => buf.toString('base64url')
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf)
}

/** 키가 없으면(SLACK_SIGNING_SECRET 미설정) null — 호출부가 503 으로 처리한다. */
export function createOAuthState(
  purpose: string,
  input: { spaceId: string; userId: string; clientId: string }
): { state: string; nonce: string } | null {
  const key = stateKey(purpose)
  if (!key) return null
  const nonce = crypto.randomBytes(24).toString('base64url')
  const payload: OAuthStatePayload = {
    ...input,
    nonceHash: sha256(nonce),
    exp: Date.now() + OAUTH_STATE_TTL_SEC * 1000,
  }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = b64url(crypto.createHmac('sha256', key).update(payloadB64).digest())
  return { state: `${payloadB64}.${sig}`, nonce }
}

export function verifyOAuthState(purpose: string, state: string): OAuthStatePayload | null {
  const key = stateKey(purpose)
  if (!key) return null
  const dot = state.indexOf('.')
  if (dot <= 0) return null
  const payloadB64 = state.slice(0, dot)
  const expected = b64url(crypto.createHmac('sha256', key).update(payloadB64).digest())
  if (!safeEqual(expected, state.slice(dot + 1))) return null
  try {
    const p = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as OAuthStatePayload
    if (typeof p.exp !== 'number' || Date.now() > p.exp) return null
    for (const k of ['spaceId', 'userId', 'clientId', 'nonceHash'] as const) {
      if (typeof p[k] !== 'string' || !p[k]) return null
    }
    return p
  } catch {
    return null
  }
}

/** 쿠키의 nonce 원문이 state 의 해시와 같은가. */
export function oauthNonceMatches(
  payload: OAuthStatePayload,
  cookieNonce: string | undefined
): boolean {
  return !!cookieNonce && safeEqual(sha256(cookieNonce), payload.nonceHash)
}
