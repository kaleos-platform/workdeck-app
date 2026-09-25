jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn().mockResolvedValue({ space: { id: 'space-1' } }),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    delBatch: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const findMany = jest.mocked(prisma.delBatch.findMany)
const count = jest.mocked(prisma.delBatch.count)

function request(query: string): Parameters<typeof GET>[0] {
  return { nextUrl: new URL(`http://localhost/api/sh/shipping/batches${query}`) } as Parameters<
    typeof GET
  >[0]
}

const batch = {
  id: 'batch-1',
  status: 'COMPLETED',
  source: 'MANUAL',
  label: '배송 묶음',
  createdAt: new Date('2026-09-23T00:00:00.000Z'),
  completedAt: new Date('2026-09-24T03:00:00.000Z'),
  _count: { orders: 3 },
}

describe('GET /api/sh/shipping/batches', () => {
  beforeEach(() => {
    findMany.mockReset()
    count.mockReset()
    findMany.mockResolvedValue([])
    count.mockResolvedValue(0)
  })

  test('KST 완료일 기간의 전체 묶음을 페이지 제한 없이 조회한다', async () => {
    findMany.mockResolvedValue([batch, { ...batch, id: 'batch-2' }] as never)

    const response = (await GET(request('?from=2026-09-24&to=2026-09-25&page=3&pageSize=1')))!
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(findMany).toHaveBeenCalledWith({
      where: {
        spaceId: 'space-1',
        completedAt: {
          gte: new Date('2026-09-23T15:00:00.000Z'),
          lt: new Date('2026-09-25T15:00:00.000Z'),
        },
      },
      orderBy: { completedAt: 'desc' },
      include: { _count: { select: { orders: true } } },
    })
    expect(count).not.toHaveBeenCalled()
    expect(body).toEqual({
      data: [
        {
          id: 'batch-1',
          status: 'COMPLETED',
          source: 'MANUAL',
          label: '배송 묶음',
          orderCount: 3,
          createdAt: batch.createdAt,
          completedAt: batch.completedAt,
        },
        {
          id: 'batch-2',
          status: 'COMPLETED',
          source: 'MANUAL',
          label: '배송 묶음',
          orderCount: 3,
          createdAt: batch.createdAt,
          completedAt: batch.completedAt,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 2,
    })
  })

  test.each([
    '?from=2026-09-24',
    '?to=2026-09-25',
    '?from=2026-02-30&to=2026-09-25',
    '?from=2026-09-24&to=2026-13-01',
    '?from=2026-9-24&to=2026-09-25',
    '?from=2026-09-26&to=2026-09-25',
  ])('불완전하거나 유효하지 않은 기간 %s를 거부한다', async (query) => {
    const response = (await GET(request(query)))!

    expect(response.status).toBe(400)
    expect(findMany).not.toHaveBeenCalled()
    expect(count).not.toHaveBeenCalled()
  })

  test('날짜가 없으면 기존 페이지 조회를 유지한다', async () => {
    findMany.mockResolvedValue([batch] as never)
    count.mockResolvedValue(5)

    const response = (await GET(request('?status=COMPLETED&page=2&pageSize=1')))!
    const body = await response.json()

    expect(findMany).toHaveBeenCalledWith({
      where: { spaceId: 'space-1', status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      skip: 1,
      take: 1,
      include: { _count: { select: { orders: true } } },
    })
    expect(count).toHaveBeenCalledWith({ where: { spaceId: 'space-1', status: 'COMPLETED' } })
    expect(body.total).toBe(5)
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(1)
    expect(body.data[0].orderCount).toBe(3)
  })
})
