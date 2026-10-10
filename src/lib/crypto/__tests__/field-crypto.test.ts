/** @jest-environment node */
import crypto from 'node:crypto'
import {
  assertFieldCryptoBootConfig,
  decryptField,
  derivePurposeKey,
  encryptField,
  fieldWriteVersion,
  isV1,
  needsReencrypt,
  purposeEnvName,
  V1_IV_MARKER,
  type CryptoPurpose,
} from '../field-crypto'

const ROOT = 'a'.repeat(64)
const OTHER_ROOT = 'b'.repeat(64)
const LEGACY = 'c'.repeat(64)
const PURPOSES: CryptoPurpose[] = [
  'collection-credential',
  'channel-credential',
  'pii',
  'slack-token',
  'billing-key',
  'ai-key',
  'space-credential',
]

// 기존 CBC 구현(src/lib/del/encryption.ts)과 동일한 방식으로 v0 픽스처를 만든다.
function legacyCbc(plaintext: string, hexKey: string) {
  const iv = crypto.randomBytes(16)
  const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(hexKey, 'hex'), iv)
  return { encrypted: c.update(plaintext, 'utf8', 'hex') + c.final('hex'), iv: iv.toString('hex') }
}

// v1 문자열(v1:<kid>:<iv>:<tag>:<ct>)의 지정 구간(2=iv, 3=tag, 4=ct)에서 1바이트를 뒤집는다.
function flipByte(encrypted: string, part: 2 | 3 | 4): string {
  const parts = encrypted.split(':')
  const buf = Buffer.from(parts[part], 'base64')
  buf[0] ^= 0x01
  parts[part] = buf.toString('base64')
  return parts.join(':')
}

const ENV_KEYS = [
  'ENCRYPTION_KEY',
  'ENCRYPTION_KEY_V1',
  'ENCRYPTION_KEY_V1_K2',
  'ENCRYPTION_KEY_V1_ACTIVE_KID',
  'ENCRYPTION_WRITE_VERSION',
  'VERCEL_ENV',
  ...PURPOSES.flatMap((p) => [purposeEnvName(p), purposeEnvName(p, 'k2')]),
]

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
  process.env.ENCRYPTION_KEY_V1 = ROOT
  process.env.ENCRYPTION_KEY = LEGACY
})

describe('field-crypto v1 (AES-256-GCM)', () => {
  test.each(PURPOSES)('%s 왕복', (purpose) => {
    const stored = encryptField(purpose, '비밀 값 ✓')
    expect(stored.iv).toBe(V1_IV_MARKER)
    expect(stored.encrypted).toMatch(/^v1:k1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$/)
    expect(isV1(stored.encrypted)).toBe(true)
    expect(decryptField(purpose, stored.encrypted, stored.iv)).toBe('비밀 값 ✓')
  })

  test('빈 문자열도 왕복한다', () => {
    const stored = encryptField('pii', '')
    expect(decryptField('pii', stored.encrypted, stored.iv)).toBe('')
  })

  test('같은 평문이라도 매번 다른 암호문(랜덤 IV)', () => {
    expect(encryptField('pii', 'x').encrypted).not.toBe(encryptField('pii', 'x').encrypted)
  })

  test.each([2, 3, 4] as const)('구간 %i 의 1바이트 변조 → 복호화 실패', (part) => {
    const stored = encryptField('channel-credential', '{"cookies":[]}')
    expect(() =>
      decryptField('channel-credential', flipByte(stored.encrypted, part), 'v1')
    ).toThrow()
  })

  test('잘린 인증 태그(4바이트)는 거부한다', () => {
    const parts = encryptField('pii', 'x').encrypted.split(':')
    parts[3] = Buffer.from(parts[3], 'base64').subarray(0, 4).toString('base64')
    expect(() => decryptField('pii', parts.join(':'), 'v1')).toThrow('v1 암호문 형식')
  })

  test('용도 A 키로 만든 암호문은 용도 B 로 풀 수 없다', () => {
    const stored = encryptField('pii', '010-0000-0000')
    expect(() => decryptField('billing-key', stored.encrypted, stored.iv)).toThrow()
  })

  test('다른 루트 키(= preview 키)로는 운영 암호문을 풀 수 없다', () => {
    const stored = encryptField('collection-credential', 'pw')
    process.env.ENCRYPTION_KEY_V1 = OTHER_ROOT
    expect(() => decryptField('collection-credential', stored.encrypted, stored.iv)).toThrow()
  })

  test('ENCRYPTION_KEY_<PURPOSE> 파생 키만 있어도(루트 없음) 해당 용도는 풀린다', () => {
    const stored = encryptField('slack-token', 'xoxb-1')
    process.env[purposeEnvName('slack-token')] = derivePurposeKey(
      Buffer.from(ROOT, 'hex'),
      'slack-token'
    ).toString('hex')
    delete process.env.ENCRYPTION_KEY_V1
    expect(decryptField('slack-token', stored.encrypted, stored.iv)).toBe('xoxb-1')
    expect(() => decryptField('pii', encryptField('slack-token', 'y').encrypted, 'v1')).toThrow(
      'ENCRYPTION_KEY'
    )
  })

  test('v1 루트 키 미설정 → ENCRYPTION_KEY 문구 포함 오류(기존 500 분기 유지)', () => {
    delete process.env.ENCRYPTION_KEY_V1
    expect(() => encryptField('pii', 'x')).toThrow('ENCRYPTION_KEY_V1')
  })

  test('키 길이 오류 → 명시적 오류', () => {
    process.env.ENCRYPTION_KEY_V1 = 'abcd'
    expect(() => encryptField('pii', 'x')).toThrow('32바이트')
  })
})

describe('field-crypto v0 (레거시 CBC)', () => {
  test('v0 와 v1 이 섞여 있어도 모두 읽힌다', () => {
    const rows = [legacyCbc('old', LEGACY), encryptField('pii', 'new')]
    expect(rows.map((r) => decryptField('pii', r.encrypted, r.iv))).toEqual(['old', 'new'])
  })

  test('v0 는 용도와 무관하게 레거시 원키로 풀린다', () => {
    const v0 = legacyCbc('bot', LEGACY)
    expect(decryptField('slack-token', v0.encrypted, v0.iv)).toBe('bot')
  })

  test('v0 키(ENCRYPTION_KEY) 미설정 → v1 루트로 시도하지 않고 명시적 오류', () => {
    const v0 = legacyCbc('x', LEGACY)
    delete process.env.ENCRYPTION_KEY
    expect(() => decryptField('pii', v0.encrypted, v0.iv)).toThrow('ENCRYPTION_KEY 미설정')
  })

  test("iv='none'(평문 폴백) 은 더 이상 읽지 않는다", () => {
    expect(() => decryptField('collection-credential', 'plain-pw', 'none')).toThrow('iv=none')
  })
})

describe('키 ID 와 회전', () => {
  test('활성 키를 k2 로 바꾸면 새 값은 k2 로 쓰고, k1 값도 계속 읽힌다', () => {
    const old = encryptField('pii', 'old')
    process.env.ENCRYPTION_KEY_V1_K2 = OTHER_ROOT
    process.env.ENCRYPTION_KEY_V1_ACTIVE_KID = 'k2'
    const fresh = encryptField('pii', 'new')
    expect(old.encrypted.startsWith('v1:k1:')).toBe(true)
    expect(fresh.encrypted.startsWith('v1:k2:')).toBe(true)
    expect(fresh.iv).toBe(V1_IV_MARKER)
    expect(decryptField('pii', old.encrypted, old.iv)).toBe('old')
    expect(decryptField('pii', fresh.encrypted, fresh.iv)).toBe('new')
    expect(needsReencrypt('pii', old.encrypted)).toBe(true)
    expect(needsReencrypt('pii', fresh.encrypted)).toBe(false)
  })

  test('k2 는 용도 키(ENCRYPTION_KEY_<PURPOSE>_K2)만 있어도 읽힌다(워커 배포 형태)', () => {
    process.env.ENCRYPTION_KEY_V1_K2 = OTHER_ROOT
    process.env.ENCRYPTION_KEY_V1_ACTIVE_KID = 'k2'
    const stored = encryptField('slack-token', 'xoxb-2')
    process.env[purposeEnvName('slack-token', 'k2')] = derivePurposeKey(
      Buffer.from(OTHER_ROOT, 'hex'),
      'slack-token'
    ).toString('hex')
    delete process.env.ENCRYPTION_KEY_V1_K2
    expect(decryptField('slack-token', stored.encrypted, stored.iv)).toBe('xoxb-2')
  })

  test('옛 키(k1)를 지우면 k1 값은 ENCRYPTION_KEY 문구 오류', () => {
    const old = encryptField('pii', 'old')
    process.env.ENCRYPTION_KEY_V1_K2 = OTHER_ROOT
    process.env.ENCRYPTION_KEY_V1_ACTIVE_KID = 'k2'
    delete process.env.ENCRYPTION_KEY_V1
    expect(() => decryptField('pii', old.encrypted, old.iv)).toThrow('ENCRYPTION_KEY_V1')
  })

  test('키 ID 를 바꿔치기한 암호문은 풀리지 않는다', () => {
    process.env.ENCRYPTION_KEY_V1_K2 = OTHER_ROOT
    const stored = encryptField('pii', 'x')
    expect(() => decryptField('pii', stored.encrypted.replace('v1:k1:', 'v1:k2:'), 'v1')).toThrow()
  })

  test('형식이 틀린 키 ID 는 거부한다', () => {
    process.env.ENCRYPTION_KEY_V1_ACTIVE_KID = 'K1'
    expect(() => encryptField('pii', 'x')).toThrow('ENCRYPTION_KEY_V1_ACTIVE_KID')
    delete process.env.ENCRYPTION_KEY_V1_ACTIVE_KID
    const parts = encryptField('pii', 'x').encrypted.split(':')
    parts[1] = 'kx'
    expect(() => decryptField('pii', parts.join(':'), 'v1')).toThrow('v1 암호문 형식')
  })
})

describe('쓰기 버전(ENCRYPTION_WRITE_VERSION) — 롤백 호환', () => {
  test('v0 이면 기존 CBC 형식으로 쓴다(구버전 decryptPii 가 읽는 형식)', () => {
    process.env.ENCRYPTION_WRITE_VERSION = 'v0'
    const stored = encryptField('pii', '홍길동')
    expect(stored.iv).toMatch(/^[0-9a-f]{32}$/)
    expect(isV1(stored.encrypted)).toBe(false)
    const d = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(LEGACY, 'hex'),
      Buffer.from(stored.iv, 'hex')
    )
    expect(d.update(stored.encrypted, 'hex', 'utf8') + d.final('utf8')).toBe('홍길동')
    expect(decryptField('pii', stored.encrypted, stored.iv)).toBe('홍길동')
  })

  test('v0 쓰기 동안에는 재암호화 대상이 없다', () => {
    const v0 = legacyCbc('x', LEGACY)
    expect(needsReencrypt('pii', v0.encrypted)).toBe(true)
    process.env.ENCRYPTION_WRITE_VERSION = 'v0'
    expect(needsReencrypt('pii', v0.encrypted)).toBe(false)
  })

  test('운영(VERCEL_ENV=production)에서 값이 없으면 v0, 명시하면 그 값', () => {
    expect(fieldWriteVersion()).toBe('v1')
    process.env.VERCEL_ENV = 'production'
    expect(fieldWriteVersion()).toBe('v0')
    process.env.ENCRYPTION_WRITE_VERSION = 'v1'
    expect(fieldWriteVersion()).toBe('v1')
  })

  test('space-credential 은 v0 쓰기 중에도 v1(읽는 구버전 코드가 없다)', () => {
    process.env.ENCRYPTION_WRITE_VERSION = 'v0'
    expect(encryptField('space-credential', 's').iv).toBe(V1_IV_MARKER)
  })

  test('v0 쓰기인데 ENCRYPTION_KEY 가 없으면 명시적 오류', () => {
    process.env.ENCRYPTION_WRITE_VERSION = 'v0'
    delete process.env.ENCRYPTION_KEY
    expect(() => encryptField('pii', 'x')).toThrow('ENCRYPTION_KEY 미설정')
  })

  test('잘못된 값은 오류', () => {
    process.env.ENCRYPTION_WRITE_VERSION = 'v2'
    expect(() => encryptField('pii', 'x')).toThrow('ENCRYPTION_WRITE_VERSION')
  })

  test('부팅 검사: v0 쓰기는 ENCRYPTION_KEY(K0)가 있을 때만 통과, v1 은 K0 없이 통과', () => {
    process.env.ENCRYPTION_WRITE_VERSION = 'v0'
    expect(() => assertFieldCryptoBootConfig()).not.toThrow()
    delete process.env.ENCRYPTION_KEY
    expect(() => assertFieldCryptoBootConfig()).toThrow('ENCRYPTION_KEY 미설정')
    process.env.ENCRYPTION_WRITE_VERSION = 'v1'
    expect(() => assertFieldCryptoBootConfig()).not.toThrow()
  })

  test('부팅 검사: K0 폐기 뒤 운영에서 쓰기 버전을 지우면(기본 v0) 부팅 실패', () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.ENCRYPTION_KEY
    expect(() => assertFieldCryptoBootConfig()).toThrow('ENCRYPTION_KEY 미설정')
  })
})
