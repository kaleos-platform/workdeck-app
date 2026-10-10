/** @jest-environment node */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { decryptSecret, encryptField } from '../encryption.js'

const LEGACY = 'c'.repeat(64)

beforeEach(() => {
  process.env.ENCRYPTION_KEY_V1 = 'a'.repeat(64)
  process.env.ENCRYPTION_KEY = LEGACY
})

test('워커는 앱이 쓴 v1 을 읽는다', () => {
  const { encrypted, iv } = encryptField('collection-credential', 'pw!')
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
