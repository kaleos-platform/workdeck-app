/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { listApplications } from '@/lib/hiring/applications'
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
  process.env.QA_APPLICANT_SPACE = spaces[0]
  for (const [index, spaceId] of spaces.entries()) {
    await prisma.space.create({ data: { id: spaceId, name: `[QA] 합성 고객 ${index}` } })
    created.push(spaceId)
    const posting = await prisma.hiringPosting.create({
      data: { spaceId, title: `[QA] 합성 공고 ${index}`, status: 'DRAFT' },
    })
    const application = await prisma.hiringApplication.create({
      data: {
        spaceId,
        postingId: posting.id,
        maskedName: index ? '타*고' : '우*고',
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
    공고: '[QA] 합성 공고 0',
    '합성 응답': '내 고객 응답',
    지원일: '2026-09-27',
  })
  expect(JSON.stringify(rows)).not.toContain('다른 고객 응답')
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
