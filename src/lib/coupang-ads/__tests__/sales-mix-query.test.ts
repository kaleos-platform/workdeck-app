/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    coupangCredential: { findUnique: jest.fn() },
  },
}))

import { querySalesMix } from '@/lib/coupang-ads/sales-mix-query'

const { prisma } = jest.requireMock('@/lib/prisma') as {
  prisma: { $queryRaw: jest.Mock; coupangCredential: { findUnique: jest.Mock } }
}
const opts = { startDate: '2026-06-01', endDate: '2026-06-07' }

// 쿼리 순서: 벤더 상품 / 벤더 일별 / 광고 옵션 / 광고 일별 / 옵션→상품 매핑
function mockRows(products: unknown[]) {
  prisma.$queryRaw
    .mockResolvedValueOnce(products)
    .mockResolvedValueOnce([{ date: '2026-06-01', revenue: '12000.00' }])
    .mockResolvedValueOnce([
      { optionId: 'o1', adCost: '1000.00', adRevenue: '3000.00', period: 'cur' },
    ])
    .mockResolvedValueOnce([{ date: '2026-06-01', adCost: '1000.00' }])
    .mockResolvedValueOnce([{ optionId: 'o1', productId: 'p1' }])
}

describe('querySalesMix', () => {
  beforeEach(() => {
    prisma.$queryRaw.mockReset()
    prisma.coupangCredential.findUnique.mockReset()
  })

  it('수집 꺼짐이면 collection-off, 쿼리 미호출', async () => {
    prisma.coupangCredential.findUnique.mockResolvedValue({ collectVendorSales: false })
    await expect(querySalesMix('w1', opts)).resolves.toEqual({ empty: 'collection-off' })
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('수집 켜짐 + 현재 기간 VENDOR 행 0이면 no-data', async () => {
    prisma.coupangCredential.findUnique.mockResolvedValue({ collectVendorSales: true })
    mockRows([])
    await expect(querySalesMix('w1', opts)).resolves.toEqual({ empty: 'no-data' })
  })

  it('문자열 Decimal 을 숫자로 변환', async () => {
    prisma.coupangCredential.findUnique.mockResolvedValue({ collectVendorSales: true })
    mockRows([
      { productId: 'p1', productName: 'A', revenue: '12000.00', salesQty: '7', period: 'cur' },
    ])
    const r = await querySalesMix('w1', opts)
    if ('empty' in r) throw new Error('unexpected empty')
    expect(r.kpi.revenue).toBe(12000)
    expect(r.kpi.adCost).toBe(1000)
  })

  it('크레덴셜 없음(null)은 꺼짐이 아니라 데이터 유무로 판단', async () => {
    prisma.coupangCredential.findUnique.mockResolvedValue(null)
    mockRows([])
    await expect(querySalesMix('w1', opts)).resolves.toEqual({ empty: 'no-data' })
    expect(prisma.$queryRaw).toHaveBeenCalled()
  })
})
