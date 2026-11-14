/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: { hiringPosting: { findFirst: jest.fn(), updateManyAndReturn: jest.fn() } },
}))
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: async () => ({ space: { id: 's' } }),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))

const params = { params: Promise.resolve({ id: 'p' }) }
const request = (closingDate: unknown) =>
  new NextRequest('http://localhost/actions', {
    method: 'POST',
    body: JSON.stringify({ action: 'extend', closingDate }),
  })

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(prisma.hiringPosting.findFirst).mockResolvedValue({
    id: 'p',
    status: 'CLOSED',
    publishedAt: new Date('2026-07-01'),
    closingDate: new Date('2026-07-18'),
  } as never)
})

it('발행된 공고의 마감일을 늦추고 접수 상태로 되돌린다(조건부 갱신)', async () => {
  jest
    .mocked(prisma.hiringPosting.updateManyAndReturn)
    .mockResolvedValue([
      { id: 'p', status: 'ACTIVE', closingDate: new Date('2099-12-31') },
    ] as never)
  const res = await POST(request('2099-12-31'), params)
  expect(res?.status).toBe(200)
  expect(prisma.hiringPosting.updateManyAndReturn).toHaveBeenCalledWith({
    where: {
      id: 'p',
      spaceId: 's',
      publishedAt: { not: null },
      status: { in: ['ACTIVE', 'CLOSED'] },
      closingDate: { lt: new Date('2099-12-31') },
    },
    data: { closingDate: new Date('2099-12-31'), status: 'ACTIVE' },
    select: { id: true, status: true, closingDate: true },
  })
})

it('기존보다 이르거나 같은 날짜·상시 모집·초안·보관 공고는 갱신되지 않으면 409', async () => {
  jest.mocked(prisma.hiringPosting.updateManyAndReturn).mockResolvedValue([])
  expect((await POST(request('2099-12-31'), params))?.status).toBe(409)
})

it.each([null, undefined, '2020-01-01'])(
  '마감일 없음·지난 날짜(%s)는 갱신하지 않는다',
  async (date) => {
    const res = await POST(request(date), params)
    expect(res?.status).toBe(400)
    expect(prisma.hiringPosting.updateManyAndReturn).not.toHaveBeenCalled()
  }
)
