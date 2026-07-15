/**
 * Slack 요청 서명 검증.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * 서명 = 'v0=' + HMAC-SHA256(signing_secret, `v0:${timestamp}:${rawBody}`).
 * timestamp가 ±300초 창 밖이면 리플레이로 간주해 실패.
 */
import crypto from 'node:crypto'

const MAX_SKEW_SEC = 300 // ±5분

/** 길이 불일치도 throw 없이 false를 반환하는 상수 시간 비교. */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

export function verifySlackSignature(input: {
  signingSecret: string
  timestamp: string | null
  rawBody: string
  signature: string | null
}): boolean {
  const { signingSecret, timestamp, rawBody, signature } = input
  if (!signingSecret || !timestamp || !signature) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > MAX_SKEW_SEC) return false

  const base = `v0:${timestamp}:${rawBody}`
  const digest = crypto.createHmac('sha256', signingSecret).update(base).digest('hex')
  const expected = `v0=${digest}`

  return safeEqual(expected, signature)
}
