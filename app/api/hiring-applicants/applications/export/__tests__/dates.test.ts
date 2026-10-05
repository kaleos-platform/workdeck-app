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
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringApplication: { findMany: jest.fn() },
    hiringPosting: { findMany: jest.fn(async () => []) },
    hiringMigrationRecord: { findMany: jest.fn(async () => []) },
  },
}))
jest.mock('@/lib/hiring/applications', () => ({
  ...jest.requireActual('@/lib/hiring/application-shared'),
  listApplications: jest.fn(async () => ({ rows: [], total: 0 })),
}))
jest.mock('@/lib/hiring/migration/ledger', () => ({
  decodeMigrationSnapshot: jest.fn((r) => r.snapshot),
}))
jest.mock('@/lib/hiring/pii', () => ({ decryptApplicationPii: () => ({ name: 'QA' }) }))
jest.mock('@/components/hiring-applicants/applications-table', () => ({
  ApplicationsTable: () => null,
}))

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.hiringMigrationRecord.findMany as jest.Mock).mockResolvedValue([])
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

const legacySnapshot = {
  schemaVersion: 'opening-application-v1',
  application: {
    id: 'source-app',
    status: 1,
    stage: 4,
    hiring_stage: 1,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    required_privacy_agreed_at: null,
    optional_privacy_agreed_at: null,
    cancelled_at: null,
    deleted_at: null,
    application_entries: [
      { label: '중복 질문', type: 'multiselect', value: [0, 2] },
      { label: '중복 질문', type: 'string', value: '=SUM(1,2)' },
      { label: '빈 값', type: 'string', value: null },
    ],
  },
  entryInterpretation: [],
  fileMappings: [],
}

it('이전 원문을 질문 순서와 타입 그대로 별도 시트에 보존한다', async () => {
  ;(prisma.hiringApplication.findMany as jest.Mock).mockResolvedValue([
    {
      id: 'app-1',
      spaceId: 'qa-space',
      files: [],
      createdAt: new Date('2026-09-01'),
      stage: 'REJECTED',
      hiringStage: 'APPLIED',
      posting: { title: 'QA' },
      applicationEntries: [],
    },
  ])
  ;(prisma.hiringMigrationRecord.findMany as jest.Mock).mockResolvedValue([
    {
      targetId: 'app-1',
      sourceSnapshotAt: new Date('2026-09-01'),
      snapshot: legacySnapshot,
    },
  ])
  const response = await GET(new NextRequest('http://localhost/api/export'))
  const workbook = XLSX.read(Buffer.from(await response!.arrayBuffer()), { type: 'buffer' })
  expect(workbook.SheetNames).toContain('이전 원문')
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['이전 원문'])
  expect(rows).toEqual([
    expect.objectContaining({
      지원서ID: 'app-1',
      항목순서: 1,
      질문: '중복 질문',
      원본값: '[0,2]',
      해석: '미확정',
    }),
    expect.objectContaining({ 항목순서: 2, 질문: '중복 질문', 원본값: '"=SUM(1,2)"' }),
    expect.objectContaining({ 항목순서: 3, 원본값: 'null' }),
  ])
  expect(prisma.hiringMigrationRecord.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { spaceId: 'qa-space', targetModel: 'HiringApplication', targetId: { in: ['app-1'] } },
    })
  )
})

it('이전 원장 해석 실패 시 누락된 엑셀을 성공 응답하지 않는다', async () => {
  ;(prisma.hiringApplication.findMany as jest.Mock).mockResolvedValue([
    {
      id: 'app-1',
      spaceId: 'qa-space',
      files: [],
      createdAt: new Date('2026-09-01'),
      stage: 'REJECTED',
      hiringStage: 'APPLIED',
      posting: { title: 'QA' },
      applicationEntries: [],
    },
  ])
  ;(prisma.hiringMigrationRecord.findMany as jest.Mock).mockResolvedValue([
    {
      targetId: 'app-1',
      sourceSnapshotAt: new Date('2026-09-01'),
      snapshot: {},
    },
  ])
  const response = await GET(new NextRequest('http://localhost/api/export'))
  expect(response!.status).toBe(422)
})

it('첨부는 검증된 파일명만 내보내고 Storage 경로와 미확정 참조를 노출하지 않는다', async () => {
  ;(prisma.hiringApplication.findMany as jest.Mock).mockResolvedValue([
    {
      id: 'app-1',
      spaceId: 'qa-space',
      files: [
        {
          id: 'file-1',
          applicationId: 'app-1',
          spaceId: 'qa-space',
          fileName: 'resume.pdf',
          sizeBytes: 10,
        },
      ],
      createdAt: new Date('2026-09-01'),
      stage: 'REJECTED',
      hiringStage: 'APPLIED',
      posting: { title: 'QA' },
      applicationEntries: [],
    },
  ])
  ;(prisma.hiringMigrationRecord.findMany as jest.Mock).mockResolvedValue([
    {
      targetId: 'app-1',
      sourceSnapshotAt: new Date('2026-09-01'),
      snapshot: {
        ...legacySnapshot,
        application: {
          ...legacySnapshot.application,
          application_entries: [
            { label: '첨부', type: 'file', value: ['private/source-key', 'unmatched-key'] },
          ],
        },
        fileMappings: [
          {
            entryIndex: 0,
            sourceFileKey: 'private/source-key',
            targetFileId: 'file-1',
            sha256: 'a'.repeat(64),
            sizeBytes: 10,
            verified: true,
          },
        ],
      },
    },
  ])
  const response = await GET(new NextRequest('http://localhost/api/export'))
  expect(response!.headers.get('Cache-Control')).toBe('private, no-store')
  const workbook = XLSX.read(Buffer.from(await response!.arrayBuffer()), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['이전 원문'])
  expect(rows).toEqual([expect.objectContaining({ 첨부파일: '["resume.pdf"]', 미확정첨부수: 1 })])
  expect(JSON.stringify(rows)).not.toMatch(/private\/source-key|unmatched-key/)
})

it('긴 원문을 잘라내거나 손상된 엑셀로 내려주지 않는다', async () => {
  ;(prisma.hiringApplication.findMany as jest.Mock).mockResolvedValue([
    {
      id: 'app-1',
      spaceId: 'qa-space',
      files: [],
      createdAt: new Date('2026-09-01'),
      stage: 'REJECTED',
      hiringStage: 'APPLIED',
      posting: { title: 'QA' },
      applicationEntries: [],
    },
  ])
  ;(prisma.hiringMigrationRecord.findMany as jest.Mock).mockResolvedValue([
    {
      targetId: 'app-1',
      sourceSnapshotAt: new Date('2026-09-01'),
      snapshot: {
        ...legacySnapshot,
        application: {
          ...legacySnapshot.application,
          application_entries: [{ type: 'string', value: 'x'.repeat(32768) }],
        },
      },
    },
  ])
  const response = await GET(new NextRequest('http://localhost/api/export'))
  expect(response!.status).toBe(422)
})

it.each([null, { type: 'string', value: { invalid: true } }])(
  '손상된 개별 원문 항목은 성공 export하지 않는다: %s',
  async (entry) => {
    ;(prisma.hiringApplication.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'app-1',
        spaceId: 'qa-space',
        files: [],
        createdAt: new Date('2026-09-01'),
        stage: 'REJECTED',
        hiringStage: 'APPLIED',
        posting: { title: 'QA' },
        applicationEntries: [],
      },
    ])
    ;(prisma.hiringMigrationRecord.findMany as jest.Mock).mockResolvedValue([
      {
        targetId: 'app-1',
        sourceSnapshotAt: new Date('2026-09-01'),
        snapshot: {
          ...legacySnapshot,
          application: { ...legacySnapshot.application, application_entries: [entry] },
        },
      },
    ])
    const response = await GET(new NextRequest('http://localhost/api/export'))
    expect(response!.status).toBe(422)
  }
)

it('목록과 엑셀에 동일한 이름 검색 조건을 적용한다', async () => {
  const search = 'a'.repeat(64)
  await ApplicationsPage({ searchParams: Promise.resolve({ search }) })
  await GET(new NextRequest('http://localhost/api/export?search=' + search))
  expect(listApplications).toHaveBeenCalledWith('qa-space', expect.objectContaining({ search }))
  expect(prisma.hiringApplication.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ spaceId: 'qa-space', OR: [{ nameHash: search }] }),
    })
  )
})

it('잘못된 검색 토큰을 전체 지원자 엑셀로 확대하지 않는다', async () => {
  await GET(new NextRequest('http://localhost/api/export?search=invalid'))
  expect(prisma.hiringApplication.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ spaceId: 'qa-space', id: { in: [] } }),
    })
  )
})

it('검색 기록 이동 시 다른 검색의 선택 상태가 재사용되지 않는다', async () => {
  const a = await ApplicationsPage({ searchParams: Promise.resolve({ search: 'a'.repeat(64) }) })
  const b = await ApplicationsPage({ searchParams: Promise.resolve({ search: 'b'.repeat(64) }) })
  expect(a.props.children[1].key).not.toBe(b.props.children[1].key)
})
