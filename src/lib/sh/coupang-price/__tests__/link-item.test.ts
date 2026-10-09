/** @jest-environment node */
import { linkCoupangItem } from '../link-item'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    productListing: { findFirst: jest.fn() },
    coupangProductItem: { findFirst: jest.fn(), update: jest.fn() },
  },
}))
const m = prisma as unknown as {
  productListing: { findFirst: jest.Mock }
  coupangProductItem: { findFirst: jest.Mock; update: jest.Mock }
}
// 1번째 findFirst = 대상 쿠팡 옵션, 2번째 = 리스팅에 이미 연결된 다른 옵션
const setup = (
  item: { listingId: string | null; excludedAt: Date | null },
  conflicting: unknown = null
) => {
  m.productListing.findFirst.mockResolvedValue({ id: 'L-new' })
  m.coupangProductItem.findFirst
    .mockResolvedValueOnce({ id: 'i1', ...item })
    .mockResolvedValueOnce(conflicting)
  m.coupangProductItem.update.mockResolvedValue({})
}

beforeEach(() => jest.resetAllMocks())

test('기본 확정은 기존 연결을 교체하지 않는다', async () => {
  setup({ listingId: 'L-old', excludedAt: null })
  expect(await linkCoupangItem('s', 'i1', 'L-new')).toMatchObject({ ok: false, status: 400 })
  expect(m.coupangProductItem.update).not.toHaveBeenCalled()
})

test('기본 확정은 매칭 안 함 항목을 되살리지 않는다', async () => {
  setup({ listingId: null, excludedAt: new Date() })
  expect(await linkCoupangItem('s', 'i1', 'L-new')).toMatchObject({ ok: false, status: 400 })
  expect(m.coupangProductItem.update).not.toHaveBeenCalled()
})

test('explicit 은 기존 연결을 update 한 번으로 교체하고 매칭 안 함도 푼다', async () => {
  setup({ listingId: 'L-old', excludedAt: new Date() })
  expect(await linkCoupangItem('s', 'i1', 'L-new', { explicit: true })).toEqual({ ok: true })
  expect(m.coupangProductItem.update).toHaveBeenCalledTimes(1)
  expect(m.coupangProductItem.update).toHaveBeenCalledWith({
    where: { id: 'i1' },
    data: { listingId: 'L-new', excludedAt: null },
  })
})

test('explicit 이어도 리스팅이 다른 쿠팡 옵션에 연결돼 있으면 거부한다', async () => {
  setup({ listingId: 'L-old', excludedAt: null }, { id: 'other' })
  expect(await linkCoupangItem('s', 'i1', 'L-new', { explicit: true })).toMatchObject({ ok: false })
  expect(m.coupangProductItem.update).not.toHaveBeenCalled()
})

test('동시 확정의 unique 위반은 409 충돌로 돌려준다', async () => {
  setup({ listingId: null, excludedAt: null })
  m.coupangProductItem.update.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))
  expect(await linkCoupangItem('s', 'i1', 'L-new')).toMatchObject({ ok: false, status: 409 })
})
