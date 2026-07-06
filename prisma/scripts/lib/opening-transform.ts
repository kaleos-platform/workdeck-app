/**
 * opening-transform.ts
 *
 * opening DB 로우 → workdeck Prisma createInput 순수 변환 함수.
 * DB 접근 없음 — 단독 단위 테스트 가능.
 *
 * 변환 대상:
 *   store            → HiringStore createInput
 *   position         → HiringPosition createInput
 *   posting          → HiringPosting createInput
 *   posting_position → HiringPostingPosition createInput
 *   application      → HiringApplication createInput  (PII decrypt→re-encrypt)
 *   comment          → HiringComment createInput
 *   blacklist        → HiringBlacklist createInput
 *   message_template → HiringMessageTemplate createInput
 */
import crypto from 'node:crypto'
import { openingDecrypt } from './opening-crypto'
import {
  normalizePhone,
  normalizeEmail,
  normalizeName,
  maskName,
  hmacHash,
  buildApplicationPii,
  buildBlacklistPhone,
  type ApplicationEntryValue,
} from '../../../src/lib/hiring/pii'
import { encryptPii } from '../../../src/lib/del/encryption'

// ─── 결정론적 UUID (uuidv5) ───────────────────────────────────────────────────

/** opening 애플리케이션 ID → workdeck uuid 결정론적 변환용 고정 네임스페이스 */
const APPL_MIGRATION_NS = '1b671a64-40d5-491e-99b0-da01ff1f3341'

/**
 * uuidv5 — SHA-1 기반 결정론적 UUID.
 * `uuid` 패키지 없이 Node crypto 만 사용.
 */
export function deterministicUuid(name: string, namespace = APPL_MIGRATION_NS): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const nameBytes = Buffer.from(name, 'utf8')
  const digest = crypto.createHash('sha1').update(nsBytes).update(nameBytes).digest()
  // RFC4122 v5: version=5, variant=10xx
  digest[6] = (digest[6]! & 0x0f) | 0x50
  digest[8] = (digest[8]! & 0x3f) | 0x80
  const h = digest.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

// ─── 상태 매핑 ────────────────────────────────────────────────────────────────

/** opening POSTING_STATUS → HiringPostingStatus */
export function mapPostingStatus(status: number): 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED' {
  // CREATED=2, TEMPORARY_SAVED=3 → DRAFT
  // ACTIVE=1 → ACTIVE
  // CLOSED=4 → CLOSED
  // INACTIVE=0 → ARCHIVED
  switch (status) {
    case 1: return 'ACTIVE'
    case 4: return 'CLOSED'
    case 0: return 'ARCHIVED'
    default: return 'DRAFT' // 2, 3
  }
}

/** opening APPL_STAGE → HiringApplicationStage */
export function mapApplicationStage(stage: number): 'HIRING' | 'ACCEPTED' | 'REJECTED' {
  // HIRING=1, ACCEPTED=3, REJECTED=4
  switch (stage) {
    case 3: return 'ACCEPTED'
    case 4: return 'REJECTED'
    default: return 'HIRING'
  }
}

/** opening APPL_HIRING_STAGE → HiringProcessStage */
export function mapHiringStage(hiringStage: number): 'APPLIED' | 'INTERVIEW' | 'JOB_OFFER' {
  // APPLIED=1, INTERVIEW=2, JOB_OFFER=3
  switch (hiringStage) {
    case 2: return 'INTERVIEW'
    case 3: return 'JOB_OFFER'
    default: return 'APPLIED'
  }
}

/** opening JOB_TYPE 문자열 → HiringJobType enum (매핑 안 되면 null) */
export function mapJobType(
  jobType: string | null | undefined,
): 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'FREELANCER' | 'INTERN' | null {
  switch (jobType) {
    case 'full_time':   return 'FULL_TIME'
    case 'part_time':   return 'PART_TIME'
    case 'contract':    return 'CONTRACT'
    case 'free_lancer': return 'FREELANCER'
    case 'intern':      return 'INTERN'
    default:            return null
  }
}

/** opening JOB_PAY_FREQUENCY 문자열 → HiringPayFrequency enum (매핑 안 되면 null) */
export function mapPayFrequency(
  freq: string | null | undefined,
): 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'PER_TASK' | 'TBD' | null {
  switch (freq) {
    case 'hourly':    return 'HOURLY'
    case 'daily':     return 'DAILY'
    case 'weekly':    return 'WEEKLY'
    case 'monthly':   return 'MONTHLY'
    case 'yearly':    return 'YEARLY'
    case 'per_task':  return 'PER_TASK'
    case 'tbd':       return 'TBD'
    default:          return null
  }
}

// ─── 날짜 필터 헬퍼 ───────────────────────────────────────────────────────────

/** 날짜가 since 이후인지 확인 (null 허용 — null은 범위 밖으로 처리) */
export function isWithinWindow(date: Date | null | undefined, since: Date): boolean {
  if (!date) return false
  return date >= since
}

// ─── Store 변환 ───────────────────────────────────────────────────────────────

export type OpeningStoreRow = {
  id: number
  name: string
  brand_id: number
  status: number
  // address join (LEFT JOIN address a ON s.address_id = a.id)
  road_address?: string | null
  original_addr2?: string | null // 상세주소
  zipcode?: string | null
}

export type HiringStoreInput = {
  name: string
  roadAddress: string | null
  detailAddress: string | null
  zipcode: string | null
  isActive: boolean
}

export function transformStore(row: OpeningStoreRow): HiringStoreInput {
  return {
    name: row.name,
    roadAddress: row.road_address ?? null,
    detailAddress: row.original_addr2 ?? null,
    zipcode: row.zipcode ?? null,
    isActive: row.status === 1,
  }
}

// ─── Position 변환 ────────────────────────────────────────────────────────────

export type OpeningPositionRow = {
  id: number
  name: string
  brand_id: number
  status: number
  category_name?: string | null
}

export type HiringPositionInput = {
  name: string
  category: string | null
  isActive: boolean
}

export function transformPosition(row: OpeningPositionRow): HiringPositionInput {
  return {
    name: row.name,
    category: row.category_name ?? null,
    isActive: row.status === 1,
  }
}

// ─── Posting 변환 ─────────────────────────────────────────────────────────────

export type OpeningPostingRow = {
  id: number
  uuid: string
  brand_id: number
  title: string
  status: number
  detail: unknown
  application_entries: unknown
  closing_date?: Date | null
  published_at?: Date | null
  notification_enabled?: boolean
  member_id?: number | null
  // manager 암호화 컬럼 (opening 포맷: base64ciphertext|hexiv)
  manager_name_enc?: string | null
  manager_phone_enc?: string | null
  manager_email_enc?: string | null
  created_at: Date
}

export type HiringPostingInput = {
  uuid: string
  title: string
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED'
  detail: unknown
  applicationEntries: unknown
  closingDate: Date | null
  publishedAt: Date | null
  notificationEnabled: boolean
  authorUserId: string | null
  // 담당자 PII — workdeck 포맷(hex encoded)으로 재암호화
  managerNameEnc: string | null
  managerNameIv: string | null
  managerPhoneEnc: string | null
  managerPhoneIv: string | null
}

export function transformPosting(row: OpeningPostingRow): HiringPostingInput {
  // 담당자 PII 복호화 → 재암호화 (workdeck AES 키)
  const managerName = openingDecrypt(row.manager_name_enc)
  const managerPhone = openingDecrypt(row.manager_phone_enc)

  const nameEnc = managerName ? encryptPii(managerName) : null
  const phoneEnc = managerPhone ? encryptPii(managerPhone) : null

  return {
    uuid: row.uuid,
    title: row.title,
    status: mapPostingStatus(row.status),
    detail: row.detail ?? null,
    applicationEntries: row.application_entries ?? null,
    closingDate: row.closing_date ?? null,
    publishedAt: row.published_at ?? null,
    notificationEnabled: row.notification_enabled ?? true,
    authorUserId: row.member_id ? String(row.member_id) : null,
    managerNameEnc: nameEnc?.encrypted ?? null,
    managerNameIv: nameEnc?.iv ?? null,
    managerPhoneEnc: phoneEnc?.encrypted ?? null,
    managerPhoneIv: phoneEnc?.iv ?? null,
  }
}

// ─── PostingPosition 변환 ─────────────────────────────────────────────────────

export type OpeningPostingPositionRow = {
  id: number
  name: string
  posting_id: number
  position_id?: number | null
  brand_id: number
  job_type?: string | null
  pay_frequency?: string | null
  pay_amount?: number | null
  work_days?: number[] | null
  work_start_time?: string | null
  work_end_time?: string | null
  intake?: number | null
  job_description?: string | null
  education?: string | null
  required_qualifications?: string | null
  preferred_qualifications?: string | null
}

export type HiringPostingPositionInput = {
  name: string
  jobType: ReturnType<typeof mapJobType>
  payFrequency: ReturnType<typeof mapPayFrequency>
  payAmount: number | null
  workDays: number[] | null
  workStartAt: string | null
  workEndAt: string | null
  headcount: number | null
  education: string | null
  jobDescription: string | null
  requiredQualifications: string | null
  preferredQualifications: string | null
}

export function transformPostingPosition(
  row: OpeningPostingPositionRow,
): HiringPostingPositionInput {
  return {
    name: row.name,
    jobType: mapJobType(row.job_type),
    payFrequency: mapPayFrequency(row.pay_frequency),
    payAmount: row.pay_amount ?? null,
    workDays: row.work_days?.length ? row.work_days : null,
    workStartAt: row.work_start_time || null,
    workEndAt: row.work_end_time || null,
    headcount: row.intake ?? null,
    education: row.education || null,
    jobDescription: row.job_description || null,
    requiredQualifications: row.required_qualifications || null,
    preferredQualifications: row.preferred_qualifications || null,
  }
}

// ─── Application 변환 ─────────────────────────────────────────────────────────

export type OpeningApplicationRow = {
  id: number
  posting_id: number
  posting_position_id?: number | null
  brand_id: number
  status: number
  stage: number
  hiring_stage: number
  application_entries: ApplicationEntryValue[]
  referrer?: string | null
  direct_registration?: boolean
  duplicated?: boolean
  memo?: string | null
  required_privacy_agreed_at?: Date | null
  optional_privacy_agreed_at?: Date | null
  cancelled_at?: Date | null
  deleted_at?: Date | null
  created_at: Date
}

export type HiringApplicationInput = {
  uuid: string
  applicationEntries: ApplicationEntryValue[]
  // PII columns
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
  // stage
  stage: 'HIRING' | 'ACCEPTED' | 'REJECTED'
  hiringStage: 'APPLIED' | 'INTERVIEW' | 'JOB_OFFER'
  // metadata
  referrer: string | null
  directRegistration: boolean
  duplicated: boolean
  memo: string | null
  privacyAgreedAt: Date | null
  canceledAt: Date | null
  deletedAt: Date | null
}

/**
 * application 변환.
 * application_entries 에서 PII(name/phone/email/address)를 추출해
 * workdeck enc/iv/hash 컬럼으로 재암호화한다.
 * 로그에는 마스킹된 이름만 출력하도록 maskedName 을 반환한다.
 */
export function transformApplication(row: OpeningApplicationRow): HiringApplicationInput {
  const uuid = deterministicUuid(String(row.id))
  const entries: ApplicationEntryValue[] = Array.isArray(row.application_entries)
    ? row.application_entries
    : []

  // buildApplicationPii 가 PII 추출 + enc/iv/hash 컬럼 생성 + sanitizedEntries 반환
  const { columns, sanitizedEntries } = buildApplicationPii(entries)

  const privacyAgreedAt =
    row.required_privacy_agreed_at ?? row.optional_privacy_agreed_at ?? null

  return {
    uuid,
    applicationEntries: sanitizedEntries,
    ...columns,
    stage: mapApplicationStage(row.stage),
    hiringStage: mapHiringStage(row.hiring_stage),
    referrer: row.referrer || null,
    directRegistration: row.direct_registration ?? false,
    duplicated: row.duplicated ?? false,
    memo: row.memo || null,
    privacyAgreedAt,
    canceledAt: row.cancelled_at ?? null,
    deletedAt: row.deleted_at ?? null,
  }
}

// ─── Comment 변환 ─────────────────────────────────────────────────────────────

export type OpeningCommentRow = {
  id: number
  source_id: number // application.id
  member_id?: number | null
  content: string
  status: number
  edited_at?: Date | null
  deleted_at?: Date | null
  created_at: Date
}

export type HiringCommentInput = {
  userId: string // opening member_id → 문자열 (workdeck 사용자와 불일치 주의)
  content: string
  editedAt: Date | null
  deletedAt: Date | null
}

export function transformComment(row: OpeningCommentRow): HiringCommentInput {
  return {
    userId: row.member_id ? String(row.member_id) : 'unknown',
    content: row.content,
    editedAt: row.edited_at ?? null,
    deletedAt: row.deleted_at ?? null,
  }
}

// ─── Blacklist 변환 ───────────────────────────────────────────────────────────

export type OpeningBlacklistRow = {
  id: number
  space_id: number
  phone_enc: string
  phone_hash: string
  status: number
}

export type HiringBlacklistInput = {
  phoneEnc: string
  phoneIv: string
  phoneHash: string
  isActive: boolean
}

/**
 * blacklist 변환.
 * opening phone_enc (opening 키) 복호화 → workdeck 키로 재암호화.
 * 복호화 실패 시 null 반환 — 호출 측에서 스킵 처리.
 */
export function transformBlacklist(row: OpeningBlacklistRow): HiringBlacklistInput | null {
  const phone = openingDecrypt(row.phone_enc)
  if (!phone) return null
  const normalized = normalizePhone(phone)
  const pii = buildBlacklistPhone(normalized)
  return {
    phoneEnc: pii.phoneEnc,
    phoneIv: pii.phoneIv,
    phoneHash: pii.phoneHash,
    isActive: row.status === 1,
  }
}

// ─── MessageTemplate 변환 ────────────────────────────────────────────────────

export type OpeningMessageTemplateRow = {
  id: number
  brand_id: number
  title: string
  content: string
  status: number
  last_used_at?: Date | null
}

export type HiringMessageTemplateInput = {
  title: string
  content: string
  lastUsedAt: Date | null
}

export function transformMessageTemplate(
  row: OpeningMessageTemplateRow,
): HiringMessageTemplateInput | null {
  if (row.status !== 1) return null // INACTIVE 스킵
  return {
    title: row.title,
    content: row.content,
    lastUsedAt: row.last_used_at ?? null,
  }
}

// re-export for test convenience
export { normalizePhone, normalizeEmail, normalizeName, maskName, hmacHash }
