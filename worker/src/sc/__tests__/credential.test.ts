/** @jest-environment node */
import assert from 'node:assert/strict'
import { encryptField } from '../../encryption.js'
import { openCredential } from '../credential.js'

beforeEach(() => {
  process.env.ENCRYPTION_KEY_V1 = 'a'.repeat(64)
})

test('암호문 credential 을 channel-credential 키로 연다', () => {
  const sealed = encryptField('channel-credential', JSON.stringify({ accessToken: 't' }))
  assert.deepEqual(
    openCredential({ encryptedPayload: sealed.encrypted, iv: sealed.iv, expiresAt: null }),
    { payload: { accessToken: 't' } }
  )
})

test('다른 용도 키로 만든 암호문은 열지 않는다(null)', () => {
  const sealed = encryptField('pii', '{}')
  const err = console.error
  console.error = () => {}
  assert.equal(openCredential({ encryptedPayload: sealed.encrypted, iv: sealed.iv }), null)
  console.error = err
})

test('전환 기간: 구버전 앱의 평문 { payload } 도 받는다', () => {
  assert.deepEqual(openCredential({ payload: { a: 1 } }), { payload: { a: 1 } })
})

test('없음 → null', () => {
  assert.equal(openCredential(null), null)
  assert.equal(openCredential(undefined), null)
})
