/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext } from '@/lib/api-helpers'
import { loadOptionDemand, loadSalesDemandChannels } from '@/lib/inv/option-demand'
import { loadReorderStockInputs, toKstDateKey } from '@/lib/inv/reorder-engine'

jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return { ...actual, resolveDeckContext: jest.fn() }
})
jest.mock('@/lib/prisma', () => ({
  prisma: { invProduct: { findMany: jest.fn() }, invMovement: { findMany: jest.fn() } },
}))
jest.mock('@/lib/inv/option-demand', () => ({
  loadOptionDemand: jest.fn(),
  loadSalesDemandChannels: jest.fn(),
}))
jest.mock('@/lib/inv/reorder-engine', () => ({
  ...jest.requireActual('@/lib/inv/reorder-engine/models'),
  ...jest.requireActual('@/lib/inv/reorder-engine/order-qty'),
  ...jest.requireActual('@/lib/inv/reorder-engine/series'),
  ...jest.requireActual('@/lib/inv/reorder-engine/plan-product'),
  loadNetByDate: jest.fn().mockResolvedValue(new Map()),
  loadReorderStockInputs: jest.fn(),
}))

describe('GET /api/sh/inventory/reorder — 홈 재고 알림(발주 엔진 공식)', () => {
  it('일률 × (리드타임 + 목표 커버일수) 기준으로 발주량을 계산한다', async () => {
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 's1' } })
    ;(prisma.invProduct.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'p1',
        name: '상품',
        internalName: null,
        code: null,
        reorderRoundUnit: 10,
        brand: null,
        options: [{ id: 'o1', name: '옵션', sku: null, safetyStockQty: 0 }],
        reorderConfig: {
          leadTimeDays: 20,
          analysisWindowDays: 90,
          targetCoverDays: 30,
          forecastModel: null,
        },
      },
    ])
    ;(loadSalesDemandChannels as jest.Mock).mockResolvedValue([{ id: 'c1' }])
    const now = Date.now()
    ;(loadOptionDemand as jest.Mock).mockResolvedValue(
      Array.from({ length: 90 }, (_, i) => ({
        date: toKstDateKey(new Date(now - (i + 1) * 86400000)),
        optionId: 'o1',
        channelId: 'c1',
        quantity: 2,
      }))
    )
    ;(loadReorderStockInputs as jest.Mock).mockResolvedValue(
      new Map([
        [
          'o1',
          {
            onHandQty: 10,
            incomingQty: 5,
            returnGradeQty: 0,
            rocketOnHandQty: 0,
            rocketIncomingQty: 0,
          },
        ],
      ])
    )

    const res = (await GET(new NextRequest('http://localhost/api/sh/inventory/reorder')))!
    const row = (await res.json()).data[0]
    // 하루 2개 × (20 + 30)일 − 재고 10 − 입고예정 5 = 85 (옛 공식은 리드타임만 봐서 25)
    expect(row.dailyAvgOutbound).toBe(2)
    expect(row.reorderQty).toBe(85)
    expect(row.currentStock).toBe(15)
    expect(row.estimatedDepletionDays).toBe(7.5)
  })
})
