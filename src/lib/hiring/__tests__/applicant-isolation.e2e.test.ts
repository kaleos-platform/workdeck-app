/** @jest-environment node */
import { randomBytes, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { listApplications } from '@/lib/hiring/applications'
import { buildApplicationPii } from '@/lib/hiring/pii'
import { buildApplicantSearchToken } from '@/lib/hiring/application-search'
import { GET as exportApplications } from '../../../../app/api/hiring-applicants/applications/export/route'
import { PATCH as updateApplication } from '../../../../app/api/hiring-applicants/applications/[id]/route'
import { PATCH as bulkUpdate } from '../../../../app/api/hiring-applicants/applications/bulk/route'

jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return {
    ...actual,
    resolveDeckContext: async () => ({
      space: { id: process.env.QA_APPLICANT_SPACE },
      role: process.env.QA_APPLICANT_ROLE ?? 'ADMIN',
    }),
  }
})
const runId = randomUUID()
const spaces = [`qa-applicant-a-${runId}`, `qa-applicant-b-${runId}`]
const created: string[] = []
let ownId = ''
let otherId = ''

beforeAll(async () => {
  const ref = 'tumkfkfgzkmisguyaghn'
  if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname !== `${ref}.supabase.co`)
    throw Error('DEV_PROJECT_REQUIRED')
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const value = process.env[key]
    if (!value) continue
    const url = new URL(value)
    if (
      url.hostname !== `db.${ref}.supabase.co` &&
      !(
        url.hostname.endsWith('.pooler.supabase.com') &&
        decodeURIComponent(url.username).endsWith(`.${ref}`)
      )
    )
      throw Error('DEV_DATABASE_REQUIRED')
  }
  if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) throw Error('DEV_DATABASE_REQUIRED')
  // 실제 고객의 암호화 키를 사용하지 않고 이 테스트 프로세스에서만 합성 키를 사용한다.
  process.env.HIRING_HMAC_KEY = randomBytes(32).toString('hex')
  process.env.ENCRYPTION_KEY_PII = randomBytes(32).toString('hex')
  process.env.ENCRYPTION_WRITE_VERSION = 'v1'
  process.env.ENCRYPTION_KEY_V1_ACTIVE_KID = 'k1'
  process.env.QA_APPLICANT_SPACE = spaces[0]
  for (const [index, spaceId] of spaces.entries()) {
    await prisma.space.create({ data: { id: spaceId, name: `[QA] 합성 고객 ${index}` } })
    created.push(spaceId)
    const posting = await prisma.hiringPosting.create({
      data: { spaceId, title: `[QA] 합성 공고 ${index}`, status: 'DRAFT' },
    })
    const pii = buildApplicationPii([
      { key: 'name', type: 'string', value: index ? '합성고객나' : '합성고객가' },
      { key: 'phone', type: 'phone', value: index ? '01099990002' : '01099990001' },
    ])
    const application = await prisma.hiringApplication.create({
      data: {
        spaceId,
        postingId: posting.id,
        ...pii.columns,
        applicationEntries: [
          {
            key: 'custom',
            type: 'string',
            label: '합성 응답',
            value: index ? '다른 고객 응답' : '내 고객 응답',
          },
        ],
        createdAt: new Date('2026-09-26T15:30:00Z'),
      },
    })
    if (index) otherId = application.id
    else {
      ownId = application.id
      await prisma.hiringApplication.create({
        data: {
          spaceId,
          postingId: posting.id,
          deletedAt: new Date(),
          createdAt: new Date('2026-09-26T15:30:00Z'),
          applicationEntries: [
            { key: 'custom', type: 'string', label: '합성 응답', value: '삭제된 응답' },
          ],
        },
      })
    }
  }
})
afterAll(async () => {
  for (const id of created)
    if (id.startsWith('qa-applicant-') && spaces.includes(id))
      await prisma.space.deleteMany({ where: { id } })
  expect(await prisma.space.count({ where: { id: { in: created } } })).toBe(0)
  await prisma.$disconnect()
})

it('목록과 Excel은 같은 고객의 기간 내 미삭제 지원서만 반환한다', async () => {
  const from = new Date('2026-09-26T15:00:00.000Z'),
    to = new Date('2026-09-27T14:59:59.999Z')
  const list = await listApplications(spaces[0], { page: 1, pageSize: 50, from, to })
  expect(list.rows.map((row) => row.id)).toEqual([ownId])
  const response = await exportApplications(
    new NextRequest('http://localhost/export?from=2026-09-27&to=2026-09-27')
  )
  expect(response?.status).toBe(200)
  const workbook = XLSX.read(Buffer.from(await response!.arrayBuffer()), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['지원자'])
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    이름: '합성고객가',
    전화: '01099990001',
    공고: '[QA] 합성 공고 0',
    '합성 응답': '내 고객 응답',
    지원일: '2026-09-27',
  })
  expect(JSON.stringify(rows)).not.toContain('다른 고객 응답')
})

it('합성 이름·전화 검색과 Excel 결과가 일치하며 다른 고객은 검색되지 않는다', async () => {
  const stored = await prisma.hiringApplication.findUniqueOrThrow({ where: { id: ownId } })
  expect(stored.nameEnc).not.toContain('합성고객가')
  expect(stored.phoneEnc).not.toContain('01099990001')
  for (const input of ['합성고객가', '01099990001', '0001']) {
    const search = buildApplicantSearchToken(input)
    const list = await listApplications(spaces[0], { page: 1, pageSize: 50, search })
    expect(list.rows.map((row) => row.id)).toEqual([ownId])
    const response = await exportApplications(
      new NextRequest(`http://localhost/export?search=${search}`)
    )
    const workbook = XLSX.read(Buffer.from(await response!.arrayBuffer()), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['지원자'])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ 이름: '합성고객가', 전화: '01099990001' })
  }
  const otherSearch = buildApplicantSearchToken('합성고객나')
  expect(
    (await listApplications(spaces[0], { page: 1, pageSize: 50, search: otherSearch })).total
  ).toBe(0)
})

it('다른 고객의 단건 상태 변경은 거부하고 일괄 변경도 자기 고객만 반영한다', async () => {
  const request = (body: unknown) =>
    new NextRequest('http://localhost/applications', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  const denied = await updateApplication(request({ stage: 'ACCEPTED' }), {
    params: Promise.resolve({ id: otherId }),
  })
  expect(denied?.status).toBe(404)
  const response = await bulkUpdate(request({ ids: [ownId, otherId], stage: 'ACCEPTED' }))
  expect(await response?.json()).toEqual({ ok: true, updated: 1 })
  expect((await prisma.hiringApplication.findUniqueOrThrow({ where: { id: ownId } })).stage).toBe(
    'ACCEPTED'
  )
  expect((await prisma.hiringApplication.findUniqueOrThrow({ where: { id: otherId } })).stage).toBe(
    'HIRING'
  )
})

it('일반 구성원은 지원자 Excel을 다운로드할 수 없다', async () => {
  process.env.QA_APPLICANT_ROLE = 'MEMBER'
  try {
    expect((await exportApplications(new NextRequest('http://localhost/export')))?.status).toBe(403)
  } finally {
    delete process.env.QA_APPLICANT_ROLE
  }
})

it('상태 변경 후 목록과 Excel이 같은 결과 필터를 적용한다', async () => {
  await prisma.hiringApplication.update({ where: { id: ownId }, data: { stage: 'ACCEPTED' } })
  const list = await listApplications(spaces[0], { page: 1, pageSize: 50, stage: 'ACCEPTED' })
  expect(list.rows.map((row) => row.id)).toEqual([ownId])
  const response = await exportApplications(
    new NextRequest('http://localhost/export?stage=ACCEPTED')
  )
  const workbook = XLSX.read(Buffer.from(await response!.arrayBuffer()), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['지원자'])
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ 결과: '합격', '합성 응답': '내 고객 응답' })
  const rejected = await exportApplications(
    new NextRequest('http://localhost/export?stage=REJECTED')
  )
  const empty = XLSX.read(Buffer.from(await rejected!.arrayBuffer()), { type: 'buffer' })
  expect(XLSX.utils.sheet_to_json(empty.Sheets['지원자'])).toHaveLength(0)
})
