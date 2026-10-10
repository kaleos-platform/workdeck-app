/**
 * 공통 필드 암호화 — AES-256-GCM(v1) 쓰기 + 레거시 AES-256-CBC(v0) 읽기.
 * 원본은 src/lib/crypto/field-crypto.ts, 워커는 worker/src/field-crypto.ts 복사본을 쓴다(바이트 동일 — worker-copy.test.ts).
 * ⚠️ node:crypto 외 import 금지 — 워커는 별도 ESM 패키지·node_modules 다.
 *
 * 저장 형식은 기존 2컬럼(암호문, iv)을 그대로 쓴다(스키마 변경 없음).
 *  - v1: 암호문 컬럼 = `v1:<kid>:<iv b64>:<tag b64>:<ct b64>`, iv 컬럼 = 'v1'
 *  - v0: 암호문 컬럼 = CBC hex, iv 컬럼 = hex IV
 * 키:
 *  - v1 = 키 ID(kid)별 용도 키. ENCRYPTION_KEY_<PURPOSE>[_K2…] 가 있으면 그 값, 없으면
 *    ENCRYPTION_KEY_V1[_K2…](루트)에서 HKDF 파생. k1 은 접미사 없음. 쓰기 kid = ENCRYPTION_KEY_V1_ACTIVE_KID(기본 k1).
 *  - v0 = 기존 ENCRYPTION_KEY 원키만(값은 바꾸지 않는다 — 구버전 코드로 롤백해도 같은 키로 읽고 쓴다).
 *    v1 루트로 대신 풀지 않는다(틀린 키 CBC 는 쓰레기 평문이 나올 수 있다).
 * 쓰기 버전: ENCRYPTION_WRITE_VERSION(v0|v1). 없으면 Vercel 운영은 v0, 그 밖은 v1.
 *  v0 쓰기는 "v0/v1 읽기 배포 → v1 쓰기 전환" 사이 롤백 호환 기간 전용이다.
 *  백필(scripts/security/reencrypt-v0.ts) 후 ENCRYPTION_KEY 를 제거하면 v0 경로는 명시적 오류가 된다.
 */
import crypto from 'node:crypto'

export type CryptoPurpose =
  | 'collection-credential'
  | 'channel-credential'
  | 'pii'
  | 'slack-token'
  | 'billing-key'
  | 'ai-key'
  | 'space-credential'

export type StoredField = { encrypted: string; iv: string }

export const V1_IV_MARKER = 'v1'
const V1_PREFIX = 'v1:'
const KID_RE = /^k[1-9][0-9]*$/
const KEY_BYTES = 32
const GCM_IV_BYTES = 12
const GCM_TAG_BYTES = 16
const CBC_IV_BYTES = 16

function readHexKey(name: string): Buffer | null {
  // K0 은 기존 getKeyBuffer(src/lib/del/encryption.ts)처럼 앞뒤 공백·줄바꿈을 허용한다(운영 값 그대로 읽기). v1 키는 엄격.
  const hex = name === 'ENCRYPTION_KEY' ? process.env[name]?.trim() : process.env[name]
  if (!hex) return null
  const buf = Buffer.from(hex, 'hex')
  if (hex.length !== KEY_BYTES * 2 || buf.length !== KEY_BYTES) {
    throw new Error(`${name} 는 32바이트(64자 hex)여야 합니다`)
  }
  return buf
}

// k1 은 기존 변수 이름 그대로, k2 부터 `_K2` 접미사.
function kidSuffix(kid: string): string {
  return kid === 'k1' ? '' : `_${kid.toUpperCase()}`
}

export function purposeEnvName(purpose: CryptoPurpose, kid = 'k1'): string {
  return `ENCRYPTION_KEY_${purpose.toUpperCase().replace(/-/g, '_')}${kidSuffix(kid)}`
}

export function derivePurposeKey(rootKey: Buffer, purpose: CryptoPurpose): Buffer {
  return Buffer.from(
    crypto.hkdfSync('sha256', rootKey, Buffer.alloc(0), `workdeck:field:${purpose}:v1`, KEY_BYTES)
  )
}

function activeKid(): string {
  const kid = process.env.ENCRYPTION_KEY_V1_ACTIVE_KID || 'k1'
  if (!KID_RE.test(kid))
    throw new Error('ENCRYPTION_KEY_V1_ACTIVE_KID 는 k1, k2 … 형식이어야 합니다')
  return kid
}

function purposeKey(purpose: CryptoPurpose, kid: string): Buffer {
  const direct = readHexKey(purposeEnvName(purpose, kid))
  if (direct) return direct
  const rootName = `ENCRYPTION_KEY_V1${kidSuffix(kid)}`
  const root = readHexKey(rootName)
  if (!root) throw new Error(`${rootName} 환경변수가 설정되지 않았습니다`)
  return derivePurposeKey(root, purpose)
}

export function fieldWriteVersion(purpose?: CryptoPurpose): 'v0' | 'v1' {
  const v =
    process.env.ENCRYPTION_WRITE_VERSION || (process.env.VERCEL_ENV === 'production' ? 'v0' : 'v1')
  if (v !== 'v0' && v !== 'v1')
    throw new Error('ENCRYPTION_WRITE_VERSION 은 v0 또는 v1 이어야 합니다')
  if (purpose === 'space-credential') return 'v1' // 이 용도를 읽는 구버전 코드가 없다
  return v
}

export function isV1(encrypted: string): boolean {
  return encrypted.startsWith(V1_PREFIX)
}

// 지금 쓰기 형식(v1 + 활성 kid)이 아니면 true. v0 쓰기 동안에는 항상 false(v0→v0 반복 방지).
export function needsReencrypt(purpose: CryptoPurpose, encrypted: string): boolean {
  if (fieldWriteVersion(purpose) === 'v0') return false
  return !isV1(encrypted) || encrypted.split(':')[1] !== activeKid()
}

// 롤백 호환 기간 전용 — 구버전 CBC 코드(src/lib/del/encryption.ts)가 읽는 형식 그대로.
function encryptV0(plaintext: string): StoredField {
  const legacy = readHexKey('ENCRYPTION_KEY')
  if (!legacy)
    throw new Error('ENCRYPTION_KEY 미설정 — v0(CBC)로 쓸 수 없습니다(ENCRYPTION_WRITE_VERSION=v0)')
  const iv = crypto.randomBytes(CBC_IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-cbc', legacy, iv)
  return {
    encrypted: cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex'),
    iv: iv.toString('hex'),
  }
}

// 부팅 검사(src/instrumentation.ts) — v0 쓰기는 K0 보존 기간 전용이다. K0 폐기 뒤 v0 전환 배포는 서버 요청이 모두 실패한다(롤포워드만).
export function assertFieldCryptoBootConfig(): void {
  // v1 쓰기면 활성 kid 형식을 부팅에서 검사한다(잘못된 값이 첫 쓰기에서야 터지지 않게).
  if (fieldWriteVersion() === 'v1') activeKid()
  if (fieldWriteVersion() === 'v0' && !readHexKey('ENCRYPTION_KEY')) {
    throw new Error(
      'ENCRYPTION_KEY 미설정 — ENCRYPTION_WRITE_VERSION=v0 은 K0 보존 기간에만 쓸 수 있습니다'
    )
  }
}

export function encryptField(purpose: CryptoPurpose, plaintext: string): StoredField {
  if (fieldWriteVersion(purpose) === 'v0') return encryptV0(plaintext)
  const kid = activeKid()
  const iv = crypto.randomBytes(GCM_IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', purposeKey(purpose, kid), iv, {
    authTagLength: GCM_TAG_BYTES,
  })
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    encrypted: `${V1_PREFIX}${kid}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`,
    iv: V1_IV_MARKER,
  }
}

// Buffer.from(…, 'base64') 는 잘못된 문자를 조용히 버린다 — 다시 인코딩해 같을 때만 받는다(빈 문자열 허용).
function strictBase64(s: string): Buffer {
  const buf = Buffer.from(s, 'base64')
  if (buf.toString('base64') !== s) throw new Error('v1 암호문 형식이 올바르지 않습니다')
  return buf
}

function decryptV1(purpose: CryptoPurpose, encrypted: string): string {
  const parts = encrypted.split(':')
  if (parts.length !== 5 || !KID_RE.test(parts[1])) {
    throw new Error('v1 암호문 형식이 올바르지 않습니다')
  }
  const iv = strictBase64(parts[2])
  const tag = strictBase64(parts[3])
  const ct = strictBase64(parts[4])
  // 짧은 태그를 받아주면 위조 난이도가 떨어진다 — 길이를 고정 검사한다.
  if (iv.length !== GCM_IV_BYTES || tag.length !== GCM_TAG_BYTES) {
    throw new Error('v1 암호문 형식이 올바르지 않습니다')
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', purposeKey(purpose, parts[1]), iv, {
    authTagLength: GCM_TAG_BYTES,
  })
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

function decryptV0(encrypted: string, iv: string): string {
  const legacy = readHexKey('ENCRYPTION_KEY')
  if (!legacy) throw new Error('ENCRYPTION_KEY 미설정 — v0(CBC) 암호문을 복호화할 수 없습니다')
  const decipher = crypto.createDecipheriv('aes-256-cbc', legacy, Buffer.from(iv, 'hex'))
  return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8')
}

export function decryptField(purpose: CryptoPurpose, encrypted: string, iv: string): string {
  if (iv === 'none') {
    throw new Error('평문으로 저장된 값입니다(iv=none). 자격증명을 다시 등록해 주세요')
  }
  if (iv === V1_IV_MARKER && !isV1(encrypted)) {
    throw new Error('v1 암호문 형식이 올바르지 않습니다')
  }
  return isV1(encrypted) ? decryptV1(purpose, encrypted) : decryptV0(encrypted, iv)
}
