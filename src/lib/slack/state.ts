/**
 * OAuth install 흐름의 state 서명.
 * state = base64url(JSON{spaceId,userId,exp}) + "." + base64url(HMAC-SHA256).
 * SLACK_SIGNING_SECRET으로 서명하고, verify 시 서명·만료를 검증한다(실패 null).
 */
import crypto from 'node:crypto'

const TTL_MS = 10 * 60 * 1000 // 10분

interface StatePayload {
  spaceId: string
  userId: string
  exp: number // epoch ms
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function sign(payloadB64: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(payloadB64).digest())
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

export function signState(input: { spaceId: string; userId: string }): string {
  const secret = process.env.SLACK_SIGNING_SECRET
  if (!secret) throw new Error('SLACK_SIGNING_SECRET 환경변수가 설정되지 않았습니다')

  const payload: StatePayload = {
    spaceId: input.spaceId,
    userId: input.userId,
    exp: Date.now() + TTL_MS,
  }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${payloadB64}.${sign(payloadB64, secret)}`
}

export function verifyState(state: string): { spaceId: string; userId: string } | null {
  const secret = process.env.SLACK_SIGNING_SECRET
  if (!secret) return null

  const dot = state.indexOf('.')
  if (dot <= 0) return null
  const payloadB64 = state.slice(0, dot)
  const sig = state.slice(dot + 1)

  if (!safeEqual(sign(payloadB64, secret), sig)) return null

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as StatePayload
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null
    if (!payload.spaceId || !payload.userId) return null
    return { spaceId: payload.spaceId, userId: payload.userId }
  } catch {
    return null
  }
}
