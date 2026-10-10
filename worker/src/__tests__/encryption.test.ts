/** @jest-environment node */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { decryptSecret, encryptField } from '../encryption.js'
import { derivePurposeKey } from '../field-crypto.js'

const ROOT = 'a'.repeat(64)
const LEGACY = 'c'.repeat(64)
const SAVED = { ...process.env }

// 셸이나 다른 테스트의 ENCRYPTION_*·VERCEL_ENV 가 쓰기 버전·키 선택을 바꾸지 못하게 매번 비운다.
function clearCryptoEnv(): void {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('ENCRYPTION_') || k === 'VERCEL_ENV') delete process.env[k]
  }
}

beforeEach(() => {
  clearCryptoEnv()
  process.env.ENCRYPTION_WRITE_VERSION = 'v1'
  process.env.ENCRYPTION_KEY_V1 = ROOT
  process.env.ENCRYPTION_KEY = LEGACY
})

afterEach(() => {
  clearCryptoEnv()
  Object.assign(process.env, SAVED)
})

test('워커는 앱이 쓴 v1 을 읽는다', () => {
  const { encrypted, iv } = encryptField('collection-credential', 'pw!')
  assert.equal(iv, 'v1')
  assert.ok(encrypted.startsWith('v1:k1:'))
  assert.equal(decryptSecret('collection-credential', encrypted, iv), 'pw!')
})

test('앱이 v1 루트로 쓴 값을 워커는 용도별 키만으로 읽는다', () => {
  const { encrypted, iv } = encryptField('collection-credential', 'pw!')
  delete process.env.ENCRYPTION_KEY_V1
  process.env.ENCRYPTION_KEY_COLLECTION_CREDENTIAL = derivePurposeKey(
    Buffer.from(ROOT, 'hex'),
    'collection-credential'
  ).toString('hex')
  assert.equal(decryptSecret('collection-credential', encrypted, iv), 'pw!')
})

test('워커는 기존 v0(CBC) 도 읽는다', () => {
  const ivBuf = crypto.randomBytes(16)
  const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(LEGACY, 'hex'), ivBuf)
  const enc = c.update('xoxb-1', 'utf8', 'hex') + c.final('hex')
  assert.equal(decryptSecret('slack-token', enc, ivBuf.toString('hex')), 'xoxb-1')
})

test("iv='none' 평문 폴백은 거부한다", () => {
  assert.throws(() => decryptSecret('collection-credential', 'plain', 'none'), /iv=none/)
})
