// @jest-environment node
/**
 * opening-transform.test.ts
 *
 * 순수 변환 함수 단위 테스트.
 * 실제 DB 연결 없음 — fixture 로우를 직접 주입.
 *
 * PII decrypt→re-encrypt 라운드트립 테스트를 위해
 * 환경변수를 테스트 전용 더미 키로 설정한다.
 */

// ─── 더미 키 설정 (테스트 전용) ──────────────────────────────────────────────
// OPENING_SECRET_KEY: 32바이트 hex(64자)
// OPENING_HMAC_KEY: 임의 문자열
// ENCRYPTION_KEY: 32바이트 hex(64자)  ← workdeck encryptPii 용
// HIRING_HMAC_KEY: 64자 hex           ← workdeck hmacHash 용

const DUMMY_OPENING_KEY = 'a'.repeat(64) // 32바이트
const DUMMY_OPENING_HMAC = 'test-opening-hmac-secret'
const DUMMY_ENCRYPTION_KEY = 'b'.repeat(64) // 32바이트
const DUMMY_HIRING_HMAC = 'c'.repeat(64)   // 최소 32바이트

beforeAll(() => {
  process.env.OPENING_SECRET_KEY = DUMMY_OPENING_KEY
  process.env.OPENING_HMAC_KEY = DUMMY_OPENING_HMAC
  process.env.ENCRYPTION_KEY = DUMMY_ENCRYPTION_KEY
  process.env.HIRING_HMAC_KEY = DUMMY_HIRING_HMAC
})

afterAll(() => {
  delete process.env.OPENING_SECRET_KEY
  delete process.env.OPENING_HMAC_KEY
  delete process.env.ENCRYPTION_KEY
  delete process.env.HIRING_HMAC_KEY
})

import * as crypto from 'crypto'
import {
  mapPostingStatus,
  mapApplicationStage,
  mapHiringStage,
  mapJobType,
  mapPayFrequency,
  isWithinWindow,
  deterministicUuid,
  transformStore,
  transformPosition,
  transformPosting,
  transformPostingPosition,
  transformApplication,
  transformBlacklist,
  transformMessageTemplate,
  type OpeningPostingPositionRow,
} from '../lib/opening-transform'
import { openingDecrypt, _resetKeyCache } from '../lib/opening-crypto'
import { decryptPii } from '../../../src/lib/del/encryption'
import { normalizePhone, hmacHash } from '../../../src/lib/hiring/pii'

// ─── 헬퍼: opening 포맷으로 암호화 ──────────────────────────────────────────

/** opening cipher.ts 와 동일한 포맷: base64ciphertext|hexiv */
function openingEncrypt(plaintext: string): string {
  const key = Buffer.from(DUMMY_OPENING_KEY, 'hex')
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  return `${encrypted}|${iv.toString('hex')}`
}

// ─── openingDecrypt 라운드트립 ────────────────────────────────────────────────

describe('openingDecrypt', () => {
  beforeEach(() => _resetKeyCache())

  it('opening 포맷 복호화 정확성', () => {
    const plain = '홍길동'
    const enc = openingEncrypt(plain)
    expect(openingDecrypt(enc)).toBe(plain)
  })

  it('null/빈값 → null 반환', () => {
    expect(openingDecrypt(null)).toBeNull()
    expect(openingDecrypt('')).toBeNull()
    expect(openingDecrypt(undefined)).toBeNull()
  })

  it('파이프 없는 잘못된 포맷 → null', () => {
    expect(openingDecrypt('notvalid')).toBeNull()
  })
})

// ─── 공고 상태 매핑 ───────────────────────────────────────────────────────────

describe('mapPostingStatus', () => {
  it('ACTIVE(1) → ACTIVE', () => expect(mapPostingStatus(1)).toBe('ACTIVE'))
  it('INACTIVE(0) → ARCHIVED', () => expect(mapPostingStatus(0)).toBe('ARCHIVED'))
  it('CREATED(2) → DRAFT', () => expect(mapPostingStatus(2)).toBe('DRAFT'))
  it('TEMPORARY_SAVED(3) → DRAFT', () => expect(mapPostingStatus(3)).toBe('DRAFT'))
  it('CLOSED(4) → CLOSED', () => expect(mapPostingStatus(4)).toBe('CLOSED'))
})

// ─── 지원 단계 매핑 ───────────────────────────────────────────────────────────

describe('mapApplicationStage', () => {
  it('HIRING(1) → HIRING', () => expect(mapApplicationStage(1)).toBe('HIRING'))
  it('ACCEPTED(3) → ACCEPTED', () => expect(mapApplicationStage(3)).toBe('ACCEPTED'))
  it('REJECTED(4) → REJECTED', () => expect(mapApplicationStage(4)).toBe('REJECTED'))
})

describe('mapHiringStage', () => {
  it('APPLIED(1) → APPLIED', () => expect(mapHiringStage(1)).toBe('APPLIED'))
  it('INTERVIEW(2) → INTERVIEW', () => expect(mapHiringStage(2)).toBe('INTERVIEW'))
  it('JOB_OFFER(3) → JOB_OFFER', () => expect(mapHiringStage(3)).toBe('JOB_OFFER'))
})

// ─── JOB_TYPE / PAY_FREQUENCY 매핑 ───────────────────────────────────────────

describe('mapJobType', () => {
  it.each([
    ['full_time', 'FULL_TIME'],
    ['part_time', 'PART_TIME'],
    ['contract', 'CONTRACT'],
    ['free_lancer', 'FREELANCER'],
    ['intern', 'INTERN'],
    ['recruiting', null],
    ['', null],
    [null, null],
  ])('%s → %s', (input, expected) => {
    expect(mapJobType(input as string)).toBe(expected)
  })
})

describe('mapPayFrequency', () => {
  it.each([
    ['hourly', 'HOURLY'],
    ['monthly', 'MONTHLY'],
    ['tbd', 'TBD'],
    ['', null],
    [null, null],
  ])('%s → %s', (input, expected) => {
    expect(mapPayFrequency(input as string)).toBe(expected)
  })
})

// ─── 날짜 필터 헬퍼 ───────────────────────────────────────────────────────────

describe('isWithinWindow', () => {
  const since = new Date('2025-01-01T00:00:00Z')

  it('since 이후 날짜 → true', () => {
    expect(isWithinWindow(new Date('2025-06-01'), since)).toBe(true)
  })
  it('since 이전 날짜 → false', () => {
    expect(isWithinWindow(new Date('2024-12-31'), since)).toBe(false)
  })
  it('null → false', () => {
    expect(isWithinWindow(null, since)).toBe(false)
  })
})

// ─── 결정론적 UUID ────────────────────────────────────────────────────────────

describe('deterministicUuid', () => {
  it('같은 입력 → 같은 UUID', () => {
    expect(deterministicUuid('123')).toBe(deterministicUuid('123'))
  })
  it('다른 입력 → 다른 UUID', () => {
    expect(deterministicUuid('123')).not.toBe(deterministicUuid('456'))
  })
  it('UUID 형식 (8-4-4-4-12)', () => {
    const uuid = deterministicUuid('42')
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

// ─── store 변환 ───────────────────────────────────────────────────────────────

describe('transformStore', () => {
  it('기본 변환', () => {
    const result = transformStore({
      id: 1,
      name: '강남점',
      brand_id: 10,
      status: 1,
      road_address: '서울 강남구 테헤란로 123',
      original_addr2: '2층',
      zipcode: '06234',
    })
    expect(result).toEqual({
      name: '강남점',
      roadAddress: '서울 강남구 테헤란로 123',
      detailAddress: '2층',
      zipcode: '06234',
      isActive: true,
    })
  })

  it('INACTIVE status → isActive=false', () => {
    expect(transformStore({ id: 2, name: '폐점', brand_id: 10, status: 0 }).isActive).toBe(false)
  })
})

// ─── position 변환 ────────────────────────────────────────────────────────────

describe('transformPosition', () => {
  it('카테고리 이름 스냅샷', () => {
    const result = transformPosition({
      id: 1, name: '바리스타', brand_id: 10, status: 1, category_name: '서비스',
    })
    expect(result.category).toBe('서비스')
    expect(result.isActive).toBe(true)
  })
})

// ─── posting 변환 ─────────────────────────────────────────────────────────────

describe('transformPosting', () => {
  const basePosting = {
    id: 1,
    uuid: 'test-uuid-1234',
    brand_id: 10,
    title: '바리스타 채용',
    status: 1,
    detail: [{ type: 'posting_title', enabled: true }],
    application_entries: [{ key: 'name', type: 'string', label: '이름' }],
    closing_date: null,
    published_at: new Date('2025-03-01'),
    notification_enabled: true,
    member_id: null,
    manager_name_enc: null,
    manager_phone_enc: null,
    manager_email_enc: null,
    created_at: new Date('2025-03-01'),
  }

  it('기본 변환', () => {
    const result = transformPosting(basePosting)
    expect(result.uuid).toBe('test-uuid-1234')
    expect(result.status).toBe('ACTIVE')
    expect(result.managerNameEnc).toBeNull()
  })

  it('담당자 PII 복호화→재암호화 라운드트립', () => {
    _resetKeyCache()
    const plainName = '홍길동'
    const row = {
      ...basePosting,
      manager_name_enc: openingEncrypt(plainName),
    }
    const result = transformPosting(row)
    expect(result.managerNameEnc).not.toBeNull()
    expect(result.managerNameIv).not.toBeNull()
    // workdeck 키로 복호화하면 원문 복원
    const decrypted = decryptPii(result.managerNameEnc!, result.managerNameIv!)
    expect(decrypted).toBe(plainName)
  })
})

// ─── application PII decrypt→re-encrypt 라운드트립 ───────────────────────────

describe('transformApplication — PII 라운드트립', () => {
  const baseApplication = {
    id: 999,
    posting_id: 1,
    posting_position_id: null,
    brand_id: 10,
    status: 1,
    stage: 1,
    hiring_stage: 1,
    application_entries: [
      { key: 'name', type: 'string', label: '이름', value: '김철수' },
      { key: 'phone', type: 'phone', label: '전화', value: '010-1234-5678' },
      { key: 'email', type: 'email', label: '이메일', value: 'test@example.com' },
      { key: 'custom_memo', type: 'text', label: '메모', value: '관심있음' },
    ],
    referrer: 'https://saramin.co.kr',
    direct_registration: false,
    duplicated: false,
    memo: null,
    required_privacy_agreed_at: new Date('2025-03-01'),
    optional_privacy_agreed_at: null,
    cancelled_at: null,
    deleted_at: null,
    created_at: new Date('2025-03-01'),
  }

  it('PII enc/iv 컬럼이 채워짐', () => {
    const result = transformApplication(baseApplication)
    expect(result.nameEnc).not.toBeNull()
    expect(result.nameIv).not.toBeNull()
    expect(result.nameHash).not.toBeNull()
    expect(result.maskedName).toBe('김*수')
    expect(result.phoneEnc).not.toBeNull()
    expect(result.phoneHash).not.toBeNull()
    expect(result.emailEnc).not.toBeNull()
  })

  it('workdeck 키로 name 복호화 → 원문 복원', () => {
    const result = transformApplication(baseApplication)
    const decrypted = decryptPii(result.nameEnc!, result.nameIv!)
    expect(decrypted).toBe('김철수')
  })

  it('phone hash = hmacHash(normalizePhone(phone))', () => {
    const result = transformApplication(baseApplication)
    const expected = hmacHash(normalizePhone('010-1234-5678'))
    expect(result.phoneHash).toBe(expected)
  })

  it('PII 항목 sanitizedEntries 에서 value 제거', () => {
    const result = transformApplication(baseApplication)
    const entries = result.applicationEntries as Array<{ key: string; value: unknown }>
    const nameEntry = entries.find((e) => e.key === 'name')
    expect(nameEntry?.value).toBeNull()
  })

  it('커스텀 항목 value 유지', () => {
    const result = transformApplication(baseApplication)
    const entries = result.applicationEntries as Array<{ key: string; value: unknown }>
    const custom = entries.find((e) => e.key === 'custom_memo')
    expect(custom?.value).toBe('관심있음')
  })

  it('결정론적 uuid — 같은 id 재실행 시 동일', () => {
    const r1 = transformApplication(baseApplication)
    const r2 = transformApplication(baseApplication)
    expect(r1.uuid).toBe(r2.uuid)
  })

  it('단계 매핑', () => {
    const result = transformApplication({ ...baseApplication, stage: 3, hiring_stage: 2 })
    expect(result.stage).toBe('ACCEPTED')
    expect(result.hiringStage).toBe('INTERVIEW')
  })
})

// ─── posting_position 변환 ────────────────────────────────────────────────────

describe('transformPostingPosition', () => {
  it('기본 필드 변환', () => {
    const row: OpeningPostingPositionRow = {
      id: 1, name: '홀서빙', posting_id: 10, position_id: 5, brand_id: 10,
      job_type: 'part_time', pay_frequency: 'hourly', pay_amount: 10000,
      work_days: [1, 2, 3, 4, 5], work_start_time: '09:00', work_end_time: '18:00',
      intake: 3, job_description: '홀 서빙 담당', education: 'high',
      required_qualifications: '서비스직 경험', preferred_qualifications: null,
    }
    const result = transformPostingPosition(row)
    expect(result.name).toBe('홀서빙')
    expect(result.jobType).toBe('PART_TIME')
    expect(result.payFrequency).toBe('HOURLY')
    expect(result.payAmount).toBe(10000)
    expect(result.workDays).toEqual([1, 2, 3, 4, 5])
    expect(result.workStartAt).toBe('09:00')
    expect(result.headcount).toBe(3)
    expect(result.education).toBe('high')
  })

  it('빈 work_days → null', () => {
    const row: OpeningPostingPositionRow = {
      id: 2, name: '주방', posting_id: 10, brand_id: 10, work_days: [],
    }
    expect(transformPostingPosition(row).workDays).toBeNull()
  })
})

// ─── application 1년 경계 필터 헬퍼 ──────────────────────────────────────────

describe('1년 경계 필터 (isWithinWindow)', () => {
  const since = new Date('2025-07-01')

  it('경계 날짜 = since → true', () => {
    expect(isWithinWindow(since, since)).toBe(true)
  })

  it('경계 바로 이전 → false', () => {
    const d = new Date(since.getTime() - 1)
    expect(isWithinWindow(d, since)).toBe(false)
  })
})

// ─── blacklist 변환 ───────────────────────────────────────────────────────────

describe('transformBlacklist', () => {
  it('정상 변환 — workdeck 키로 복호화 가능', () => {
    _resetKeyCache()
    const phone = '01012345678'
    const phoneEnc = openingEncrypt(phone)
    const result = transformBlacklist({
      id: 1, space_id: 10, phone_enc: phoneEnc, phone_hash: 'dummy', status: 1,
    })
    expect(result).not.toBeNull()
    const decrypted = decryptPii(result!.phoneEnc, result!.phoneIv)
    expect(decrypted).toBe(phone)
  })

  it('opening 복호화 실패 → null', () => {
    const result = transformBlacklist({
      id: 2, space_id: 10, phone_enc: 'bad|data', phone_hash: '', status: 1,
    })
    expect(result).toBeNull()
  })
})

// ─── message_template 변환 ────────────────────────────────────────────────────

describe('transformMessageTemplate', () => {
  it('ACTIVE 템플릿 변환', () => {
    const result = transformMessageTemplate({
      id: 1, brand_id: 10, title: '합격 안내', content: '축하합니다', status: 1, last_used_at: null,
    })
    expect(result).not.toBeNull()
    expect(result!.title).toBe('합격 안내')
  })

  it('INACTIVE 템플릿 → null', () => {
    const result = transformMessageTemplate({
      id: 2, brand_id: 10, title: '삭제됨', content: '...', status: 0,
    })
    expect(result).toBeNull()
  })
})

// ─── entries JSON passthrough ─────────────────────────────────────────────────

describe('entries JSON passthrough', () => {
  it('application_entries 가 null/빈배열일 때 빈 배열 반환', () => {
    const row = {
      id: 1,
      posting_id: 1,
      posting_position_id: null,
      brand_id: 10,
      status: 1,
      stage: 1,
      hiring_stage: 1,
      application_entries: [],
      referrer: null,
      direct_registration: false,
      duplicated: false,
      memo: null,
      required_privacy_agreed_at: null,
      optional_privacy_agreed_at: null,
      cancelled_at: null,
      deleted_at: null,
      created_at: new Date(),
    }
    const result = transformApplication(row)
    expect(Array.isArray(result.applicationEntries)).toBe(true)
    expect((result.applicationEntries as unknown[]).length).toBe(0)
  })
})
