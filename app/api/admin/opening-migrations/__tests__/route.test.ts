/** @jest-environment node */
import { NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { decryptField } from '@/lib/crypto/field-crypto'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'
import { POST } from '../[id]/route'

jest.mock('server-only', () => ({}))
jest.mock('@/lib/admin/auth', () => ({ requireOperator: jest.fn(), writeAuditLog: jest.fn() }))
jest.mock('@/lib/crypto/field-crypto', () => ({ decryptField: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    openingMigrationJob: { findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    space: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}))

const jobs = prisma.openingMigrationJob as unknown as Record<string, jest.Mock>
const params = Promise.resolve({ id: 'j1' })
const request = (body: unknown) =>
  new Request('http://localhost/api/admin/opening-migrations/j1', {
    method: 'POST',
    body: JSON.stringify(body),
  })
const planned = {
  id: 'j1',
  status: 'PLANNED',
  summary: { snapshot: { items: [] } },
  updatedAt: new Date('2026-11-18T00:00:00Z'),
  openingBrandId: '134',
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(prisma))
  ;(requireOperator as jest.Mock).mockResolvedValue({ ok: true, user: { id: 'op' } })
  jobs.findUnique.mockResolvedValue(planned)
})

test('비운영자는 404 를 그대로 받고 DB 에 접근하지 않는다', async () => {
  ;(requireOperator as jest.Mock).mockResolvedValue({
    ok: false,
    response: NextResponse.json({ message: 'Not Found' }, { status: 404 }),
  })
  expect((await GET()).status).toBe(404)
  expect((await POST(request({ action: 'approve' }), { params })).status).toBe(404)
  expect(jobs.findMany).not.toHaveBeenCalled()
  expect(jobs.findUnique).not.toHaveBeenCalled()
  expect(jobs.updateMany).not.toHaveBeenCalled()
})

test('GET 은 연락처 조각을 복호화하고 Space 이름을 붙인다', async () => {
  jobs.findMany.mockResolvedValue([
    {
      id: 'j1',
      openingBrandId: '134',
      user: { email: 'a@b.co' },
      targetSpaceId: 's1',
      status: 'PLANNED',
      summary: null,
      blockReasons: [],
      contactHitsEnc: 'enc',
      contactHitsIv: 'v1',
    },
  ])
  ;(prisma.space.findMany as jest.Mock).mockResolvedValue([{ id: 's1', name: '공간' }])
  ;(decryptField as jest.Mock).mockReturnValue(JSON.stringify([{ title: 't', fragments: ['f'] }]))
  const body = await (await GET()).json()
  expect(body.jobs[0]).toMatchObject({
    userEmail: 'a@b.co',
    targetSpaceName: '공간',
    contactHits: [{ title: 't', fragments: ['f'] }],
  })
})

test('GET 은 snapshot 을 내려주지 않고 hasSnapshot 으로만 알린다', async () => {
  jobs.findMany.mockResolvedValue([
    {
      id: 'j1',
      openingBrandId: '1',
      user: null,
      targetSpaceId: null,
      status: 'PLANNED',
      summary: { brandName: '가', snapshot: { items: [{ sourceId: 'x' }] } },
      blockReasons: [],
      contactHitsEnc: null,
      contactHitsIv: null,
    },
  ])
  ;(prisma.space.findMany as jest.Mock).mockResolvedValue([])
  const body = await (await GET()).json()
  expect(body.jobs[0].hasSnapshot).toBe(true)
  expect(body.jobs[0].summary).toEqual({ brandName: '가' })
})

test('승인 요청의 updatedAt 이 현재와 다르면 409, 같으면 통과', async () => {
  jobs.updateMany.mockResolvedValue({ count: 1 })
  const stale = await POST(request({ action: 'approve', updatedAt: '2026-11-17T00:00:00.000Z' }), {
    params,
  })
  expect(stale.status).toBe(409)
  expect(jobs.updateMany).not.toHaveBeenCalled()
  const fresh = await POST(
    request({ action: 'approve', updatedAt: planned.updatedAt.toISOString() }),
    { params }
  )
  expect(fresh.status).toBe(200)
})

test('승인은 PLANNED 조건부 update 로 snapshot 을 확정하고 감사 로그를 남긴다', async () => {
  jobs.updateMany.mockResolvedValue({ count: 1 })
  expect((await POST(request({ action: 'approve' }), { params })).status).toBe(200)
  expect(jobs.updateMany).toHaveBeenCalledWith({
    where: { id: 'j1', status: 'PLANNED', updatedAt: planned.updatedAt },
    data: expect.objectContaining({
      status: 'APPROVED',
      approvedBy: 'op',
      approvedSnapshot: { items: [] },
    }),
  })
  expect(writeAuditLog).toHaveBeenCalledWith(
    'op',
    'openingMigration.approve',
    'openingMigrationJob',
    'j1',
    expect.anything(),
    prisma
  )
})

test('동시 승인 2회면 1회만 반영하고 나머지는 409', async () => {
  jobs.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
  const statuses = [
    (await POST(request({ action: 'approve' }), { params })).status,
    (await POST(request({ action: 'approve' }), { params })).status,
  ]
  expect(statuses).toEqual([200, 409])
  expect(writeAuditLog).toHaveBeenCalledTimes(1)
})

test('PLANNED 가 아니거나 snapshot 이 없으면 승인은 409', async () => {
  jobs.findUnique.mockResolvedValue({ ...planned, status: 'BLOCKED' })
  expect((await POST(request({ action: 'approve' }), { params })).status).toBe(409)
  jobs.findUnique.mockResolvedValue({ ...planned, summary: {} })
  expect((await POST(request({ action: 'approve' }), { params })).status).toBe(409)
  expect(jobs.updateMany).not.toHaveBeenCalled()
})

test('연락처 조각을 복호화하지 못하면 승인은 409, 복호화되면 통과', async () => {
  jobs.findUnique.mockResolvedValue({ ...planned, contactHitsEnc: 'enc', contactHitsIv: 'iv' })
  ;(decryptField as jest.Mock).mockImplementationOnce(() => {
    throw new Error('bad key')
  })
  expect((await POST(request({ action: 'approve' }), { params })).status).toBe(409)
  expect(jobs.updateMany).not.toHaveBeenCalled()
  ;(decryptField as jest.Mock).mockReturnValueOnce('[]')
  jobs.updateMany.mockResolvedValue({ count: 1 })
  expect((await POST(request({ action: 'approve' }), { params })).status).toBe(200)
})

test('보류는 MATCHED·PLANNED·BLOCKED·FAILED·APPROVED 에서만, contactHits 를 비운다', async () => {
  jobs.updateMany.mockResolvedValue({ count: 1 })
  expect((await POST(request({ action: 'hold' }), { params })).status).toBe(200)
  expect(jobs.updateMany).toHaveBeenCalledWith({
    where: { id: 'j1', status: { in: ['MATCHED', 'PLANNED', 'BLOCKED', 'FAILED', 'APPROVED'] } },
    data: { status: 'HELD', contactHitsEnc: null, contactHitsIv: null },
  })
  jobs.updateMany.mockResolvedValue({ count: 0 })
  expect((await POST(request({ action: 'hold' }), { params })).status).toBe(409)
})

test('알 수 없는 action 은 400', async () => {
  expect((await POST(request({ action: 'apply' }), { params })).status).toBe(400)
})

test('GET 은 한 행의 복호화 실패를 DECRYPT_FAILED 로 표시하고 나머지는 보여 준다', async () => {
  const row = (id: string) => ({
    id,
    openingBrandId: id,
    user: null,
    targetSpaceId: null,
    status: 'PLANNED',
    summary: null,
    blockReasons: [],
    contactHitsEnc: 'enc',
    contactHitsIv: 'v1',
  })
  jobs.findMany.mockResolvedValue([row('1'), row('2')])
  ;(prisma.space.findMany as jest.Mock).mockResolvedValue([])
  ;(decryptField as jest.Mock)
    .mockImplementationOnce(() => {
      throw new Error('bad')
    })
    .mockReturnValueOnce('[]')
  const body = await (await GET()).json()
  expect(body.jobs.map((job: { contactHits: unknown }) => job.contactHits)).toEqual([
    'DECRYPT_FAILED',
    [],
  ])
})

test('감사 로그 기록이 실패하면 상태 변경도 반영되지 않도록 같은 transaction 안에서 호출한다', async () => {
  jobs.updateMany.mockResolvedValue({ count: 1 })
  await POST(request({ action: 'hold' }), { params })
  expect(prisma.$transaction).toHaveBeenCalledTimes(1)
})

test('수동 적용 완료는 APPROVED 조건부 update 로 DONE 처리하고 조각을 비우며 감사 로그를 남긴다', async () => {
  jobs.updateMany.mockResolvedValue({ count: 1 })
  jobs.findUnique.mockResolvedValue({ ...planned, status: 'APPROVED' })
  expect((await POST(request({ action: 'complete' }), { params })).status).toBe(200)
  expect(jobs.updateMany).toHaveBeenCalledWith({
    where: { id: 'j1', status: 'APPROVED' },
    data: { status: 'DONE', contactHitsEnc: null, contactHitsIv: null },
  })
  expect(writeAuditLog).toHaveBeenCalledWith(
    'op',
    'openingMigration.complete',
    'openingMigrationJob',
    'j1',
    expect.anything(),
    prisma
  )
})

test('PLANNED 에서 complete 는 조건부 update 가 0건이라 409', async () => {
  jobs.updateMany.mockResolvedValue({ count: 0 })
  expect((await POST(request({ action: 'complete' }), { params })).status).toBe(409)
  expect(writeAuditLog).not.toHaveBeenCalled()
})
