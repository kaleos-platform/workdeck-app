/** @jest-environment node */
import { decryptField } from '@/lib/crypto/field-crypto'
import { encryptSecret } from '../secret-crypto'

beforeEach(() => {
  for (const k of ['ENCRYPTION_KEY', 'ENCRYPTION_KEY_V1', 'ENCRYPTION_WRITE_VERSION', 'VERCEL_ENV'])
    delete process.env[k]
})

test('키가 없으면 평문(iv=none)으로 저장하지 않고 ENCRYPTION_KEY 오류를 던진다', () => {
  expect(() => encryptSecret('pw')).toThrow(/ENCRYPTION_KEY/)
  process.env.ENCRYPTION_WRITE_VERSION = 'v0'
  expect(() => encryptSecret('pw')).toThrow(/ENCRYPTION_KEY/)
})

test('collection-credential 용도 v1 으로 암호화한다', () => {
  process.env.ENCRYPTION_KEY_V1 = 'a'.repeat(64)
  const sealed = encryptSecret('pw')
  expect(sealed.iv).toBe('v1')
  expect(decryptField('collection-credential', sealed.encrypted, sealed.iv)).toBe('pw')
})
