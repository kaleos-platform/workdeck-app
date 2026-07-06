/**
 * 채용 deck 핵심 플로우 e2e — 실제 dev DB.
 * 검증: PII enc/hash 저장·복호 왕복, phoneHash 중복 판정, 블랙리스트 매칭,
 * 목록에 평문 PII 미노출. (파일 업로드는 Storage service key 필요 — 별도 수동 QA)
 * 선례: src/lib/inv/__tests__/reorder-plan-wizard.e2e.test.ts (throwaway space)
 */
import path from 'node:path'
import { config } from 'dotenv'
// jest는 Next 런타임 밖이라 .env.local을 직접 로드한다 (선례: reorder-plan-wizard.e2e)
config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import {
  createPublicApplication,
  listApplications,
  getApplicationDetail,
} from '@/lib/hiring/applications'
import {
  buildBlacklistPhone,
  decryptApplicationPii,
  hmacHash,
  normalizePhone,
} from '@/lib/hiring/pii'

const SPACE_ID = 'e2e00000-0000-4000-8000-00000000h1r1'
const PHONE = '010-1234-5678'
const NAME = '홍길동'
const EMAIL = 'Hong@Example.com'

async function cleanup() {
  await prisma.hiringApplication.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.hiringBlacklist.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.hiringPosting.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

describe('hiring 지원 플로우 e2e', () => {
  let postingId = ''

  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({ data: { id: SPACE_ID, name: '[E2E] hiring throwaway' } })
    const posting = await prisma.hiringPosting.create({
      data: {
        spaceId: SPACE_ID,
        title: '[E2E] 주방 보조 모집',
        status: 'ACTIVE',
        applicationEntries: [
          { key: 'name', type: 'string', label: '이름', required: true },
          { key: 'phone', type: 'phone', label: '연락처', required: true },
          { key: 'email', type: 'email', label: '이메일', required: false },
          { key: 'custom_q1', type: 'text', label: '지원 동기', required: false },
        ],
      },
    })
    postingId = posting.id
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  const entries = [
    { key: 'name', type: 'string', label: '이름', value: NAME },
    { key: 'phone', type: 'phone', label: '연락처', value: PHONE },
    { key: 'email', type: 'email', label: '이메일', value: EMAIL },
    { key: 'custom_q1', type: 'text', label: '지원 동기', value: '성실히 일하겠습니다' },
  ]

  it('지원 생성 시 PII가 enc/hash 컬럼으로 이동하고 JSON에서 제거된다', async () => {
    const { id } = await createPublicApplication({
      posting: { id: postingId, spaceId: SPACE_ID },
      entries,
      files: [],
      privacyAgreed: true,
      referrer: 'jobkorea',
    })

    const row = await prisma.hiringApplication.findUniqueOrThrow({ where: { id } })

    // enc/iv/hash 채워짐
    expect(row.nameEnc).toBeTruthy()
    expect(row.nameIv).toBeTruthy()
    expect(row.phoneHash).toBe(hmacHash(normalizePhone(PHONE)))
    expect(row.emailHash).toBe(hmacHash(EMAIL.trim().toLowerCase()))
    expect(row.maskedName).toBe('홍*동')
    expect(row.privacyAgreedAt).toBeTruthy()

    // 평문이 어떤 컬럼/JSON에도 없음
    expect(row.nameEnc).not.toContain(NAME)
    const json = JSON.stringify(row.applicationEntries)
    expect(json).not.toContain(NAME)
    expect(json).not.toContain('1234')
    expect(json).toContain('성실히') // 커스텀 항목은 유지

    // 복호 왕복
    const dec = decryptApplicationPii(row)
    expect(dec.name).toBe(NAME)
    expect(dec.phone).toBe(normalizePhone(PHONE))
    expect(dec.email).toBe(EMAIL.trim().toLowerCase())
  })

  it('같은 공고 + 같은 전화번호 재지원은 duplicated=true', async () => {
    const { id } = await createPublicApplication({
      posting: { id: postingId, spaceId: SPACE_ID },
      entries,
      files: [],
      privacyAgreed: true,
    })
    const row = await prisma.hiringApplication.findUniqueOrThrow({ where: { id } })
    expect(row.duplicated).toBe(true)
  })

  it('블랙리스트 등록 시 목록에서 phoneHash 매칭으로 표시된다', async () => {
    await prisma.hiringBlacklist.create({
      data: { spaceId: SPACE_ID, ...buildBlacklistPhone(PHONE), reason: '[E2E] 무단결근' },
    })

    const { rows, total } = await listApplications(SPACE_ID, { page: 1, pageSize: 10 })
    expect(total).toBe(2)
    expect(rows.every((r) => r.blacklisted)).toBe(true)
    // 목록 응답에 평문 PII 없음 (maskedName만)
    expect(JSON.stringify(rows)).not.toContain(NAME)
    expect(rows[0].maskedName).toBe('홍*동')
  })

  it('상세 조회는 spaceId 불일치 시 접근 불가', async () => {
    const { rows } = await listApplications(SPACE_ID, { page: 1, pageSize: 1 })
    const detail = await getApplicationDetail('wrong-space-id', rows[0].id)
    expect(detail).toBeNull()
  })
})
