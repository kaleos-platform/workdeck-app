// 생산 일률 창 = 분석 기간(기본 90) — 표시 기간 periodDays 와 별개
jest.mock('@/lib/prisma', () => ({
  prisma: {
    channel: { findMany: jest.fn() },
    invProductOption: { findMany: jest.fn() },
    invStorageLocation: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/inv/option-demand', () => ({
  loadOptionDemand: jest.fn(),
  loadSalesDemandChannels: jest.fn(),
}))
jest.mock('@/lib/inv/coupang-return-stock', () => ({
  getCoupangReturnStockByOption: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/inv/reorder-engine', () => ({
  ...jest.requireActual('@/lib/inv/reorder-engine'),
  loadReorderStockInputs: jest.fn(),
  loadNetByDate: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { loadOptionDemand, loadSalesDemandChannels } from '@/lib/inv/option-demand'
import { loadNetByDate, loadReorderStockInputs, optionDailyRate } from '@/lib/inv/reorder-engine'
import { addDaysYmd, lastClosedDateKst } from '@/lib/sh/sales-analytics'
import { queryOptionSalesVelocity } from '@/lib/sh/option-velocity-query'

const p = prisma as unknown as {
  channel: { findMany: jest.Mock }
  invProductOption: { findMany: jest.Mock }
  invStorageLocation: { findMany: jest.Mock }
}

describe('queryOptionSalesVelocity — 생산 일률 창', () => {
  it('periodDays 30 이어도 31~90일 전 판매로 MA_BLEND 일률을 낸다 (재고현황 등급과 같은 값)', async () => {
    const channel = { id: 'ch-direct', name: '자사몰', externalSource: null }
    p.channel.findMany.mockResolvedValue([channel])
    ;(loadSalesDemandChannels as jest.Mock).mockResolvedValue([channel])
    p.invStorageLocation.findMany.mockResolvedValue([
      { id: 'loc-office', type: 'OWN', externalSource: null },
    ])
    p.invProductOption.findMany.mockResolvedValue([
      {
        id: 'opt-1',
        name: '옵션',
        sku: 'SKU-1',
        safetyStockQty: 0,
        costPrice: null,
        costVatIncluded: false,
        status: 'ACTIVE',
        product: { id: 'prod-1', name: '상품', internalName: null, reorderConfig: null },
        stockLevels: [{ locationId: 'loc-office', quantity: 50 }],
      },
    ])
    ;(loadReorderStockInputs as jest.Mock).mockResolvedValue(
      new Map([
        [
          'opt-1',
          {
            onHandQty: 50,
            rocketOnHandQty: 0,
            incomingQty: 0,
            rocketIncomingQty: 0,
            returnGradeQty: 0,
          },
        ],
      ])
    )
    ;(loadNetByDate as jest.Mock).mockResolvedValue(new Map())

    // 판매는 마감일 기준 31~90일 전에만 (하루 3개)
    const to = lastClosedDateKst()
    const qtyByDate: Record<string, number> = {}
    for (let i = 30; i < 90; i++) qtyByDate[addDaysYmd(to, -i)] = 3
    ;(loadOptionDemand as jest.Mock).mockResolvedValue(
      Object.entries(qtyByDate).map(([date, quantity]) => ({
        optionId: 'opt-1',
        channelId: channel.id,
        date,
        quantity,
      }))
    )

    const res = await queryOptionSalesVelocity('space-1', { periodDays: 30, channel: 'all' })
    const row = res.rows[0]

    // 표시 기간(30일) 판매는 0
    expect(row.salesQty).toBe(0)
    // 재고현황 등급(queries.ts)과 같은 입력: 분석 기간 90 · MA_BLEND · horizon 리드타임 20 + 커버 30
    const gradeRate = optionDailyRate({
      qtyByDate,
      netByDate: {},
      currentStock: 50,
      windowDays: 90,
      horizonDays: 50,
      model: 'MA_BLEND',
      now: new Date(),
    })
    // MA30 = 0, MA90 = 180/90 = 2 → 0.4 × 2 = 0.8
    expect(gradeRate).toBeCloseTo(0.8)
    expect(row.forecastModel).toBe('MA_BLEND')
    expect(row.productionDailyRate).toBeCloseTo(0.8)
    // 수요 로드 시작이 90일 창을 덮는다
    const from = (loadOptionDemand as jest.Mock).mock.calls[0][1] as Date
    expect(from.getTime()).toBeLessThanOrEqual(
      new Date(`${addDaysYmd(to, -89)}T00:00:00+09:00`).getTime()
    )
  })
})
