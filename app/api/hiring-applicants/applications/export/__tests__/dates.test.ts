/** @jest-environment node */
import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { GET } from '../route'
import ApplicationsPage from '../../../../../d/recruiting/applications/page'
import { prisma } from '@/lib/prisma'
import { listApplications } from '@/lib/hiring/applications'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(async () => ({ space: { id: 'qa-space' }, role: 'ADMIN' })),
  assertRole: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringApplication: { findMany: jest.fn() },
    hiringPosting: { findMany: jest.fn(async () => []) },
  },
}))
jest.mock('@/lib/hiring/applications', () => ({
  ...jest.requireActual('@/lib/hiring/application-shared'),
  listApplications: jest.fn(async () => ({ rows: [], total: 0 })),
}))
jest.mock('@/lib/hiring/pii', () => ({ decryptApplicationPii: () => ({ name: 'QA' }) }))
jest.mock('@/components/hiring-applicants/applications-table', () => ({
  ApplicationsTable: () => null,
}))

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.hiringApplication.findMany as jest.Mock).mockResolvedValue([])
})

it.each(['999999999999999999999', '42949674', '1.5', '2oops', '-1', '0', ['2', '3']])(
  '잘못된 페이지 %s는 첫 페이지로 조회한다',
  async (page) => {
    await ApplicationsPage({ searchParams: Promise.resolve({ page }) })
    expect(listApplications).toHaveBeenCalledWith('qa-space', expect.objectContaining({ page: 1 }))
  }
)

it('반복 필터는 조회 조건에 배열로 전달하지 않는다', async () => {
  await ApplicationsPage({
    searchParams: Promise.resolve({
      posting: ['a', 'b'],
      stage: ['ACCEPTED'],
      from: ['2026-09-27'],
      to: ['2026-09-27'],
    }),
  })
  expect(listApplications).toHaveBeenCalledWith(
    'qa-space',
    expect.objectContaining({
      postingId: undefined,
      stage: undefined,
      from: undefined,
      to: undefined,
    })
  )
})

it('유효한 페이지와 필터는 유지한다', async () => {
  await ApplicationsPage({
    searchParams: Promise.resolve({ page: '2', posting: 'qa', stage: 'ACCEPTED' }),
  })
  expect(listApplications).toHaveBeenCalledWith(
    'qa-space',
    expect.objectContaining({ page: 2, postingId: 'qa', stage: 'ACCEPTED' })
  )
})

it('목록과 엑셀은 한국 날짜의 자정부터 마지막 밀리초까지 동일하게 조회한다', async () => {
  const params = { from: '2026-09-27', to: '2026-09-27' }
  await ApplicationsPage({ searchParams: Promise.resolve(params) })
  await GET(new NextRequest(`http://localhost/api/export?${new URLSearchParams(params)}`))
  const from = new Date('2026-09-26T15:00:00.000Z')
  const to = new Date('2026-09-27T14:59:59.999Z')
  expect(listApplications).toHaveBeenCalledWith('qa-space', expect.objectContaining({ from, to }))
  expect(prisma.hiringApplication.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { spaceId: 'qa-space', deletedAt: null, createdAt: { gte: from, lte: to } },
    })
  )
})

it('존재하지 않는 날짜를 다른 날짜로 자동 변환하지 않는다', async () => {
  await ApplicationsPage({ searchParams: Promise.resolve({ from: '2026-02-30', to: 'bad' }) })
  await GET(new NextRequest('http://localhost/api/export?from=2026-02-30&to=bad'))
  expect(listApplications).toHaveBeenCalledWith(
    'qa-space',
    expect.objectContaining({ from: undefined, to: undefined })
  )
  expect(prisma.hiringApplication.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { spaceId: 'qa-space', deletedAt: null },
    })
  )
})

it('UTC 전날인 새벽 지원도 엑셀에 한국 날짜로 기록한다', async () => {
  ;(prisma.hiringApplication.findMany as jest.Mock).mockResolvedValue([
    {
      createdAt: new Date('2026-09-26T15:00:00Z'),
      stage: 'HIRING',
      hiringStage: 'APPLIED',
      posting: { title: 'QA' },
      applicationEntries: [],
    },
  ])
  const response = await GET(new NextRequest('http://localhost/api/export'))
  const workbook = XLSX.read(Buffer.from(await response!.arrayBuffer()), { type: 'buffer' })
  expect(XLSX.utils.sheet_to_json(workbook.Sheets['지원자'])).toEqual([
    expect.objectContaining({ 지원일: '2026-09-27' }),
  ])
})

it('중복 질문명과 기본 열 이름이 충돌해도 모든 값을 독립된 열에 보존한다', async () => {
  ;(prisma.hiringApplication.findMany as jest.Mock).mockResolvedValue([
    {
      createdAt: new Date('2026-09-26T15:00:00Z'),
      stage: 'HIRING',
      hiringStage: 'APPLIED',
      posting: { title: 'QA' },
      applicationEntries: [
        { key: 'custom_a', label: '경력', type: 'string', value: '첫 답변' },
        { key: 'custom_b', label: '경력', type: 'string', value: '둘째 답변' },
        { key: 'custom_c', label: '이름', type: 'string', value: '질문 답변' },
        { key: 'custom_d', label: '__proto__', type: 'string', value: '특수 라벨 답변' },
        { key: 'custom_e', label: '경력 (2)', type: 'string', value: '원래 괄호 라벨' },
      ],
    },
  ])
  const response = await GET(new NextRequest('http://localhost/api/export'))
  const workbook = XLSX.read(Buffer.from(await response!.arrayBuffer()), { type: 'buffer' })
  const [headers, values] = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['지원자'], {
    header: 1,
  })
  expect(new Set(headers).size).toBe(headers.length)
  expect(values[headers.indexOf('이름')]).toBe('QA')
  for (const answer of ['첫 답변', '둘째 답변', '질문 답변', '특수 라벨 답변', '원래 괄호 라벨']) {
    expect(values.filter((value) => value === answer)).toHaveLength(1)
  }
  expect(headers).toHaveLength(13)
})
