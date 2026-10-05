/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { checkPublishable } from '@/lib/hiring/postings'
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    hiringPosting: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
  },
}))
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: async () => ({ space: { id: 's' } }),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/hiring/postings', () => ({ checkPublishable: jest.fn() }))
const params = { params: Promise.resolve({ id: 'p' }) }
const request = (closingDate: unknown) =>
  new NextRequest('http://localhost/actions', {
    method: 'POST',
    body: JSON.stringify({ action: 'publish', closingDate }),
  })
beforeEach(() => {
  jest.clearAllMocks()
  jest
    .mocked(prisma.$transaction)
    .mockImplementation(async (fn: unknown) => (fn as (tx: unknown) => Promise<never>)(prisma))
  jest.mocked(prisma.hiringPosting.updateMany).mockResolvedValue({ count: 1 })
  jest
    .mocked(prisma.hiringPosting.findUniqueOrThrow)
    .mockResolvedValue({ closingDate: new Date('2023-11-30') } as never)
  jest.mocked(prisma.hiringPosting.findFirst).mockResolvedValue({
    id: 'p',
    status: 'DRAFT',
    closingDate: new Date('2023-11-30'),
    publishedAt: null,
  } as never)
  jest.mocked(checkPublishable).mockResolvedValue({ ok: true, errors: [] })
  jest.mocked(prisma.hiringPosting.update).mockResolvedValue({ status: 'ACTIVE' } as never)
})
it.each(['2099-12-31', null])('마감일 %s와 발행 상태를 한 번에 저장한다', async (date) => {
  expect((await POST(request(date), params))?.status).toBe(200)
  expect(checkPublishable).toHaveBeenCalledWith('s', 'p', prisma)
  expect(prisma.hiringPosting.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: 'ACTIVE',
        closingDate: date ? new Date(date) : null,
      }),
    })
  )
})
it.each(['2023-11-30', 'invalid', '2099-02-30'])(
  '유효하지 않은 마감일 %s는 저장하지 않는다',
  async (date) => {
    expect((await POST(request(date), params))?.status).toBe(400)
    expect(prisma.hiringPosting.update).not.toHaveBeenCalled()
  }
)
it('발행 요건 실패 시 마감일도 변경하지 않는다', async () => {
  jest.mocked(checkPublishable).mockResolvedValue({ ok: false, errors: ['직무를 등록하세요'] })
  expect((await POST(request('2099-12-31'), params))?.status).toBe(400)
  expect(prisma.hiringPosting.update).not.toHaveBeenCalled()
})

it.each(['DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED'])(
  '발행 이력이 있는 %s 공고는 재발행할 수 없다',
  async (status) => {
    jest
      .mocked(prisma.hiringPosting.findFirst)
      .mockResolvedValue({ id: 'p', status, publishedAt: new Date('2023-01-01') } as never)
    expect((await POST(request('2099-12-31'), params))?.status).toBe(409)
    expect(prisma.hiringPosting.update).not.toHaveBeenCalled()
  }
)
