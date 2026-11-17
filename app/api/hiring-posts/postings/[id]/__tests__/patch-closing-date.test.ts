/** @jest-environment node */
import { NextRequest } from 'next/server'
import { PATCH } from '../route'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext } from '@/lib/api-helpers'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
  assertRole: jest.fn(),
}))
jest.mock('@/lib/hiring/postings', () => ({ getPostingDetail: jest.fn() }))
jest.mock('@/lib/hiring/unpublished-posting', () => ({
  withUnpublishedPosting: (_s: string, _i: string, write: (tx: unknown) => Promise<Response>) =>
    write(tx),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { hiringPosting: { findFirst: jest.fn() } },
}))
const tx = { hiringPosting: { update: jest.fn() } }

const call = async (body: unknown) =>
  (await PATCH(new NextRequest('http://x/api', { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'p1' }),
  })) as Response

beforeEach(() => {
  jest.resetAllMocks()
  jest.useFakeTimers().setSystemTime(new Date('2026-11-02T03:00:00Z'))
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 's1' } })
  ;(prisma.hiringPosting.findFirst as jest.Mock).mockResolvedValue({
    id: 'p1',
    status: 'DRAFT',
    publishedAt: null,
    closingDate: new Date('2026-10-01T00:00:00Z'),
  })
  tx.hiringPosting.update.mockResolvedValue({ id: 'p1' })
})
afterEach(() => jest.useRealTimers())

it('YYYY-MM-DD 가 아닌 마감일은 400', async () => {
  expect((await call({ closingDate: '내일' })).status).toBe(400)
  expect((await call({ closingDate: '2026-13-45' })).status).toBe(400)
  expect(tx.hiringPosting.update).not.toHaveBeenCalled()
})

it('바뀐 날짜가 KST 오늘 이전이면 400', async () => {
  expect((await call({ closingDate: '2026-11-01' })).status).toBe(400)
  expect(tx.hiringPosting.update).not.toHaveBeenCalled()
})

it('기존 과거 날짜를 그대로 두는 저장은 허용한다', async () => {
  expect((await call({ closingDate: '2026-10-01' })).status).toBe(200)
})

it('오늘·미래 날짜와 null(상시 모집)은 저장한다', async () => {
  expect((await call({ closingDate: '2026-11-02' })).status).toBe(200)
  expect((await call({ closingDate: '2026-12-01' })).status).toBe(200)
  expect((await call({ closingDate: null })).status).toBe(200)
  expect(tx.hiringPosting.update).toHaveBeenCalledTimes(3)
})
