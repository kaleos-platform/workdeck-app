import crypto from 'node:crypto'

// 길이 검사 후 상수 시간 문자열 비교 — 타이밍 사이드채널 방지
export function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}
