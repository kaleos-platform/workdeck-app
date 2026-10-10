/** @jest-environment node */
import crypto from 'node:crypto'
import {
  decryptField,
  encryptField,
  isV1,
  purposeEnvName,
  type CryptoPurpose,
} from '../field-crypto'
import { reencryptLegacyFields, upgradeIfLegacy } from '../reencrypt'

const LEGACY = 'c'.repeat(64)
function legacyCbc(plaintext: string) {
  const iv = crypto.randomBytes(16)
  const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(LEGACY, 'hex'), iv)
  return { encrypted: c.update(plaintext, 'utf8', 'hex') + c.final('hex'), iv: iv.toString('hex') }
}

const PURPOSES: CryptoPurpose[] = [
  'collection-credential',
  'channel-credential',
  'pii',
  'slack-token',
  'billing-key',
  'ai-key',
  'space-credential',
]
// field-crypto.test.ts 의 ENV_KEYS 와 같은 목록 — 용도별 직접 키가 남아 있으면 루트 파생 대신 그 키를 쓴다.
const ENV_KEYS = [
  'ENCRYPTION_WRITE_VERSION',
  'VERCEL_ENV',
  'ENCRYPTION_KEY_V1_K2',
  'ENCRYPTION_KEY_V1_ACTIVE_KID',
  ...PURPOSES.flatMap((p) => [purposeEnvName(p), purposeEnvName(p, 'k2')]),
]

beforeEach(() => {
  for (const k of ENV_KEYS) {
    delete process.env[k]
  }
  process.env.ENCRYPTION_KEY_V1 = 'a'.repeat(64)
  process.env.ENCRYPTION_KEY = LEGACY
})

describe('reencryptLegacyFields', () => {
  test('v0 컬럼만 v1 으로 바꾸고 v1·null·none 은 건드리지 않는다', () => {
    const name = legacyCbc('홍길동')
    const phone = encryptField('pii', '010')
    const row = {
      nameEnc: name.encrypted,
      nameIv: name.iv,
      phoneEnc: phone.encrypted,
      phoneIv: phone.iv,
      emailEnc: null,
      emailIv: null,
      addressEnc: 'plain',
      addressIv: 'none',
    }
    const data = reencryptLegacyFields('pii', row, [
      ['nameEnc', 'nameIv'],
      ['phoneEnc', 'phoneIv'],
      ['emailEnc', 'emailIv'],
      ['addressEnc', 'addressIv'],
    ])
    expect(Object.keys(data ?? {})).toEqual(['nameEnc', 'nameIv'])
    expect(isV1(data!.nameEnc)).toBe(true)
    expect(decryptField('pii', data!.nameEnc, data!.nameIv)).toBe('홍길동')
  })

  test('바꿀 컬럼이 없으면 null', () => {
    const v1 = encryptField('pii', 'x')
    expect(reencryptLegacyFields('pii', { a: v1.encrypted, b: v1.iv }, [['a', 'b']])).toBeNull()
  })

  test('활성 키가 k2 면 k1 값도 k2 로 다시 암호화한다(키 회전 백필)', () => {
    const k1 = encryptField('pii', '홍길동')
    process.env.ENCRYPTION_KEY_V1_K2 = 'b'.repeat(64)
    process.env.ENCRYPTION_KEY_V1_ACTIVE_KID = 'k2'
    const data = reencryptLegacyFields('pii', { a: k1.encrypted, b: k1.iv }, [['a', 'b']])
    expect(data!.a.startsWith('v1:k2:')).toBe(true)
    expect(decryptField('pii', data!.a, data!.b)).toBe('홍길동')
  })

  test('v0 쓰기(ENCRYPTION_WRITE_VERSION=v0) 동안에는 아무것도 바꾸지 않는다', () => {
    const name = legacyCbc('홍길동')
    process.env.ENCRYPTION_WRITE_VERSION = 'v0'
    expect(reencryptLegacyFields('pii', { a: name.encrypted, b: name.iv }, [['a', 'b']])).toBeNull()
  })
})

describe('upgradeIfLegacy', () => {
  test('v0 면 v1 으로 저장한다', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    await upgradeIfLegacy('ai-key', legacyCbc('sk-1'), 'sk-1', save)
    const next = save.mock.calls[0][0]
    expect(next.iv).toBe('v1')
    expect(decryptField('ai-key', next.encrypted, next.iv)).toBe('sk-1')
  })

  test('이미 v1 이면 저장하지 않는다', async () => {
    const save = jest.fn()
    await upgradeIfLegacy('ai-key', encryptField('ai-key', 'sk'), 'sk', save)
    expect(save).not.toHaveBeenCalled()
  })

  test('v0 쓰기 동안에는 v0 를 읽어도 저장하지 않는다(v0→v0 반복 방지)', async () => {
    process.env.ENCRYPTION_WRITE_VERSION = 'v0'
    const save = jest.fn()
    await upgradeIfLegacy('ai-key', legacyCbc('sk'), 'sk', save)
    expect(save).not.toHaveBeenCalled()
  })

  test('저장 실패는 삼키고 읽기는 계속된다', async () => {
    const save = jest.fn().mockRejectedValue(new Error('db down'))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(upgradeIfLegacy('ai-key', legacyCbc('sk'), 'sk', save)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test.each([
    ['Error', new Error('connect failed password=SYNTHETIC-SECRET-1')],
    ['비 Error 값', 'SYNTHETIC-SECRET-2 token'],
  ])('저장 실패 로그에 오류 메시지(비밀값 가능)를 남기지 않는다 — %s', async (_kind, reason) => {
    const save = jest.fn().mockRejectedValue(reason)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    await upgradeIfLegacy('ai-key', legacyCbc('sk'), 'sk', save)
    expect(warn).toHaveBeenCalled()
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SYNTHETIC-SECRET')
    warn.mockRestore()
  })
})
