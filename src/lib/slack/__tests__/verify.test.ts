// @jest-environment node
import crypto from 'node:crypto'
import { verifySlackSignature } from '../verify'

const SECRET = 'test-signing-secret'

function makeSig(secret: string, timestamp: string, rawBody: string): string {
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex')
  return `v0=${digest}`
}

describe('verifySlackSignature', () => {
  const rawBody = 'payload=%7B%22type%22%3A%22block_actions%22%7D'

  test('유효한 서명·최신 타임스탬프 → true', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = makeSig(SECRET, ts, rawBody)
    expect(
      verifySlackSignature({ signingSecret: SECRET, timestamp: ts, rawBody, signature: sig })
    ).toBe(true)
  })

  test('서명 불일치 → false', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = makeSig('wrong-secret', ts, rawBody)
    expect(
      verifySlackSignature({ signingSecret: SECRET, timestamp: ts, rawBody, signature: sig })
    ).toBe(false)
  })

  test('타임스탬프 6분 전 → false (리플레이 창 밖)', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 6 * 60)
    const sig = makeSig(SECRET, ts, rawBody)
    expect(
      verifySlackSignature({ signingSecret: SECRET, timestamp: ts, rawBody, signature: sig })
    ).toBe(false)
  })

  test('길이 다른 서명 → false (throw 아님)', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    expect(() =>
      verifySlackSignature({ signingSecret: SECRET, timestamp: ts, rawBody, signature: 'v0=short' })
    ).not.toThrow()
    expect(
      verifySlackSignature({ signingSecret: SECRET, timestamp: ts, rawBody, signature: 'v0=short' })
    ).toBe(false)
  })

  test('필수 값 누락(secret/timestamp/signature) → false', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = makeSig(SECRET, ts, rawBody)
    expect(
      verifySlackSignature({ signingSecret: '', timestamp: ts, rawBody, signature: sig })
    ).toBe(false)
    expect(
      verifySlackSignature({ signingSecret: SECRET, timestamp: null, rawBody, signature: sig })
    ).toBe(false)
    expect(
      verifySlackSignature({ signingSecret: SECRET, timestamp: ts, rawBody, signature: null })
    ).toBe(false)
  })
})
