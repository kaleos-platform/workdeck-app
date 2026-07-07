/**
 * 채용 Deck PII 처리 유틸 — 암호화·해시·토큰.
 *
 * Prisma 에는 모델 훅이 없으므로(Sequelize beforeValidate 대체 불가),
 * 지원서/블랙리스트의 모든 저장 경로는 반드시 이 모듈의 유틸을 거쳐
 * enc/iv/hash 컬럼을 만든 뒤 저장한다. (call-site 강제)
 *
 * - 암호화: AES-256-CBC — 기존 공용 유틸 재사용 (src/lib/del/encryption.ts, ENCRYPTION_KEY)
 * - 매칭 해시: HMAC-SHA256, 키 HIRING_HMAC_KEY (AES 키와 분리 — 해시 브루트포스 방어 근거)
 * - 상태알림 토큰: 원문 미저장, HMAC 해시만 저장 + 상수시간 비교
 */
import crypto from 'node:crypto'
import { encryptPii, decryptPii, type EncryptedField } from '@/lib/del/encryption'

// ─── HMAC 해시 ────────────────────────────────────────────────────────────────

function getHmacKey(): Buffer {
  const hexKey = process.env.HIRING_HMAC_KEY
  if (!hexKey) {
    throw new Error('HIRING_HMAC_KEY 환경변수가 설정되지 않았습니다')
  }
  const buf = Buffer.from(hexKey, 'hex')
  if (buf.length < 32) {
    throw new Error('HIRING_HMAC_KEY 는 최소 32바이트(64자 hex)여야 합니다')
  }
  return buf
}

/** 정규화된 값의 HMAC-SHA256 해시 (hex) — 동등검색·중복판정·블랙리스트 매칭 키 */
export function hmacHash(normalized: string): string {
  return crypto.createHmac('sha256', getHmacKey()).update(normalized, 'utf8').digest('hex')
}

// ─── 정규화 ──────────────────────────────────────────────────────────────────

/** 전화번호 → 숫자만 (예: "010-1234-5678" → "01012345678") */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function normalizeName(name: string): string {
  return name.trim()
}

/** 목록 표시용 이름 마스킹: 홍길동 → 홍*동, 김철 → 김*, John → J**n */
export function maskName(name: string): string {
  const t = name.trim()
  if (t.length <= 1) return t
  if (t.length === 2) return `${t[0]}*`
  return `${t[0]}${'*'.repeat(t.length - 2)}${t[t.length - 1]}`
}

// ─── 지원서 엔트리 PII 추출 ───────────────────────────────────────────────────

/** 지원서 폼 항목 값 (HiringApplication.applicationEntries JSON 원소) */
export type ApplicationEntryValue = {
  key: string // 표준 키(name/phone/email/address) 또는 custom_*
  type: string // string/text/number/email/phone/date/file/select/multiselect
  label?: string
  value: unknown
}

/** 표준 PII 키 — JSON에서 값을 제거하고 enc 컬럼으로 이동하는 대상 */
const PII_ENTRY_KEYS = new Set(['name', 'phone', 'email', 'address'])

export type ApplicationPiiColumns = {
  nameEnc: string | null
  nameIv: string | null
  nameHash: string | null
  maskedName: string | null
  phoneEnc: string | null
  phoneIv: string | null
  phoneHash: string | null
  phoneLastDigitsHash: string | null
  emailEnc: string | null
  emailIv: string | null
  emailHash: string | null
  addressEnc: string | null
  addressIv: string | null
}

function encOrNull(value: string | null): EncryptedField | null {
  return value ? encryptPii(value) : null
}

/**
 * 제출된 엔트리에서 표준 PII 를 추출해 enc/iv/hash 컬럼 값을 만들고,
 * JSON에 남길 정화(sanitized) 엔트리를 반환한다.
 * 표준 PII 엔트리는 value 를 null 로 비운다(구조는 유지 — 폼 스키마 대응 확인용).
 */
export function buildApplicationPii(entries: ApplicationEntryValue[]): {
  columns: ApplicationPiiColumns
  sanitizedEntries: ApplicationEntryValue[]
} {
  const raw: Record<string, string | null> = { name: null, phone: null, email: null, address: null }

  const sanitizedEntries = entries.map((entry) => {
    if (!PII_ENTRY_KEYS.has(entry.key)) return entry
    const v = typeof entry.value === 'string' ? entry.value : null
    if (v) raw[entry.key] = v
    return { ...entry, value: null }
  })

  const name = raw.name ? normalizeName(raw.name) : null
  const phone = raw.phone ? normalizePhone(raw.phone) : null
  const email = raw.email ? normalizeEmail(raw.email) : null
  const address = raw.address?.trim() || null

  const nameEnc = encOrNull(name)
  const phoneEnc = encOrNull(phone)
  const emailEnc = encOrNull(email)
  const addressEnc = encOrNull(address)

  return {
    columns: {
      nameEnc: nameEnc?.encrypted ?? null,
      nameIv: nameEnc?.iv ?? null,
      nameHash: name ? hmacHash(name) : null,
      maskedName: name ? maskName(name) : null,
      phoneEnc: phoneEnc?.encrypted ?? null,
      phoneIv: phoneEnc?.iv ?? null,
      phoneHash: phone ? hmacHash(phone) : null,
      phoneLastDigitsHash: phone && phone.length >= 4 ? hmacHash(phone.slice(-4)) : null,
      emailEnc: emailEnc?.encrypted ?? null,
      emailIv: emailEnc?.iv ?? null,
      emailHash: email ? hmacHash(email) : null,
      addressEnc: addressEnc?.encrypted ?? null,
      addressIv: addressEnc?.iv ?? null,
    },
    sanitizedEntries,
  }
}

/** enc/iv 컬럼쌍에서 평문 복원 (서버 전용 — 상세 화면·export 경로에서만 호출) */
export function decryptApplicationPii(row: {
  nameEnc: string | null
  nameIv: string | null
  phoneEnc: string | null
  phoneIv: string | null
  emailEnc: string | null
  emailIv: string | null
  addressEnc: string | null
  addressIv: string | null
}): { name: string | null; phone: string | null; email: string | null; address: string | null } {
  const dec = (enc: string | null, iv: string | null) => (enc && iv ? decryptPii(enc, iv) : null)
  return {
    name: dec(row.nameEnc, row.nameIv),
    phone: dec(row.phoneEnc, row.phoneIv),
    email: dec(row.emailEnc, row.emailIv),
    address: dec(row.addressEnc, row.addressIv),
  }
}

// ─── 블랙리스트 ──────────────────────────────────────────────────────────────

export function buildBlacklistPhone(phone: string): {
  phoneEnc: string
  phoneIv: string
  phoneHash: string
} {
  const normalized = normalizePhone(phone)
  const enc = encryptPii(normalized)
  return { phoneEnc: enc.encrypted, phoneIv: enc.iv, phoneHash: hmacHash(normalized) }
}

// ─── 상태알림 공개열람 토큰 ───────────────────────────────────────────────────

/** 토큰 발급 — 원문은 알림 URL에만 실리고 DB에는 해시만 저장 */
export function generateNotificationToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(24).toString('hex') // 48자
  return { token, tokenHash: hmacHash(token) }
}

/** 상수시간 토큰 검증 */
export function verifyNotificationToken(token: string, storedHash: string): boolean {
  const computed = Buffer.from(hmacHash(token), 'hex')
  const stored = Buffer.from(storedHash, 'hex')
  if (computed.length !== stored.length) return false
  return crypto.timingSafeEqual(computed, stored)
}
