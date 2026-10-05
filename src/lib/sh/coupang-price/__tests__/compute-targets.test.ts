/** @jest-environment node */
import { computePriceTargets } from '../compute-targets'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    channel: { findFirst: jest.fn() },
    productListing: { findMany: jest.fn() },
    coupangProductItem: { findMany: jest.fn() },
    invProductOption: { findMany: jest.fn() },
  },
}))
const m = prisma as unknown as Record<string, Record<string, jest.Mock>>

const input = {
  channelId: 'ch-rg',
  rows: [{ optionIds: ['A1'], quantity: 1 }],
  salePrice: 19_995,
  minMarginPrice: 15_001,
  includeVat: true,
}

beforeEach(() => {
  jest.clearAllMocks()
  m.channel.findFirst.mockResolvedValue({
    id: 'ch-rg',
    externalSource: 'coupang_rocket_growth',
    representativeChannelId: 'ch-mp',
  })
  m.productListing.findMany.mockResolvedValue([
    { id: 'L1', displayName: '상품 A1', items: [{ optionId: 'A1', quantity: 1 }] },
  ])
  m.coupangProductItem.findMany.mockResolvedValue([
    {
      listingId: 'L1',
      rgVendorItemId: 'rg-1',
      mpVendorItemId: 'mp-1',
      rgSalePrice: 20_000,
      mpSalePrice: 21_000,
      collectedAt: new Date(),
      sellerProductId: 'sp-1',
    },
  ])
  m.invProductOption.findMany.mockResolvedValue([])
})

test('로켓그로스 카드는 대표 채널 리스팅을 RG 축으로 계산한다', async () => {
  const r = await computePriceTargets('space-1', input)
  if ('error' in r) throw new Error(r.error)
  expect(m.productListing.findMany.mock.calls[0][0].where).toEqual({
    spaceId: 'space-1',
    channelId: 'ch-mp',
  })
  expect(r.channelAxis).toBe('RG')
  expect(r.targets[0]).toMatchObject({
    listingId: 'L1',
    vendorItemId: 'rg-1',
    currentPrice: 20_000,
    targetPrice: 20_000, // 19,995 → 10원 반올림
    apMinSalePrice: 15_010, // 15,001 → 10원 올림
    blockedReason: null,
  })
})

test('다른 space 의 채널이면 404', async () => {
  m.channel.findFirst.mockResolvedValue(null)
  expect(await computePriceTargets('space-1', input)).toEqual({
    error: '채널을 찾을 수 없습니다',
    status: 404,
  })
})
