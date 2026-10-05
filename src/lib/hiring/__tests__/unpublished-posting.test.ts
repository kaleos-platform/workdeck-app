/** @jest-environment node */
import { withUnpublishedPosting } from '../unpublished-posting'
import { prisma } from '@/lib/prisma'
jest.mock('@/lib/prisma', () => ({
  prisma: { $transaction: jest.fn(), hiringPosting: { updateMany: jest.fn() } },
}))
jest.mock('@/lib/api-helpers', () => ({
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
beforeEach(() => {
  jest.clearAllMocks()
  jest
    .mocked(prisma.$transaction)
    .mockImplementation(async (fn: unknown) => (fn as (tx: unknown) => Promise<never>)(prisma))
})
it('사전 조회 이후 발행되었으면 설정 변경을 실행하지 않는다', async () => {
  jest.mocked(prisma.hiringPosting.updateMany).mockResolvedValue({ count: 0 })
  const write = jest.fn()
  const response = await withUnpublishedPosting('s', 'p', write)
  expect(response.status).toBe(409)
  expect(write).not.toHaveBeenCalled()
  expect(prisma.hiringPosting.updateMany).toHaveBeenCalledWith({
    where: { id: 'p', spaceId: 's', status: 'DRAFT', publishedAt: null },
    data: { publishedAt: null },
  })
})
it('미발행 공고는 행 잠금을 얻은 트랜잭션에서 변경한다', async () => {
  jest.mocked(prisma.hiringPosting.updateMany).mockResolvedValue({ count: 1 })
  const write = jest.fn(async () => Response.json({ ok: true }))
  expect((await withUnpublishedPosting('s', 'p', write)).status).toBe(200)
  expect(write).toHaveBeenCalledWith(prisma)
})
