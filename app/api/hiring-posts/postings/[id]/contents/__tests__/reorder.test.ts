/** @jest-environment node */
import { PUT } from '../route'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext } from '@/lib/api-helpers'
import type { NextRequest } from 'next/server'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringPosting: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}))
const tx = { hiringContent: { findMany: jest.fn(), update: jest.fn() } }
const request = (body: unknown) => ({ json: async () => body }) as NextRequest
const params = { params: Promise.resolve({ id: 'qa' }) }
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(resolveDeckContext).mockResolvedValue({ space: { id: 'space' } } as never)
  jest.mocked(prisma.hiringPosting.findFirst).mockResolvedValue({ id: 'qa' } as never)
  tx.hiringContent.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
  tx.hiringContent.update.mockResolvedValue({})
  jest
    .mocked(prisma.$transaction)
    .mockImplementation(async (work: unknown) => (work as (arg: typeof tx) => unknown)(tx))
})
it('공고의 전체 카드 순서를 같은 트랜잭션에서 저장한다', async () => {
  const res = await PUT(request({ contentIds: ['b', 'a'] }), params)
  expect(res?.status).toBe(200)
  expect(tx.hiringContent.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { postingId: 'qa', spaceId: 'space', sourceType: 'POSTING_DETAIL' },
    })
  )
  expect(tx.hiringContent.update.mock.calls.map((call) => call[0])).toEqual([
    { where: { id: 'b' }, data: { sortOrder: 0 } },
    { where: { id: 'a' }, data: { sortOrder: 1 } },
  ])
  expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
    isolationLevel: 'Serializable',
  })
})
it.each([['a', 'a'], ['a', 'foreign'], ['a']])(
  '중복·다른 공고·누락 ID는 쓰기 전에 거절한다: %j',
  async (...contentIds) => {
    const res = await PUT(request({ contentIds }), params)
    expect([400, 409]).toContain(res?.status)
    expect(tx.hiringContent.update).not.toHaveBeenCalled()
  }
)
it('다른 공간의 공고에는 쓰지 않는다', async () => {
  jest.mocked(prisma.hiringPosting.findFirst).mockResolvedValue(null)
  expect((await PUT(request({ contentIds: ['a', 'b'] }), params))?.status).toBe(404)
  expect(prisma.$transaction).not.toHaveBeenCalled()
})
