import {
  isExternalLogisticsLocation,
  loadReorderStockInputs,
  pendingExternalQtyByOption,
} from '../stock-inputs'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invStockLevel: { groupBy: jest.fn() },
    invStorageLocation: { findMany: jest.fn() },
    productionRun: { findMany: jest.fn() },
    invReconciliation: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/inv/coupang-return-stock', () => ({
  getCoupangReturnStockByOption: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getCoupangReturnStockByOption } from '@/lib/inv/coupang-return-stock'

const p = prisma as unknown as {
  invStockLevel: { groupBy: jest.Mock }
  invStorageLocation: { findMany: jest.Mock }
  productionRun: { findMany: jest.Mock }
  invReconciliation: { findMany: jest.Mock }
}

describe('isExternalLogisticsLocation', () => {
  it('externalSource 있으면 외부', () => {
    expect(
      isExternalLogisticsLocation({ type: 'OWN', externalSource: 'coupang_rocket_growth' })
    ).toBe(true)
  })
  it('THIRD_PARTY 는 외부, OWN 은 내부', () => {
    expect(isExternalLogisticsLocation({ type: 'THIRD_PARTY', externalSource: null })).toBe(true)
    expect(isExternalLogisticsLocation({ type: 'OWN', externalSource: null })).toBe(false)
  })
})

describe('pendingExternalQtyByOption', () => {
  const now = new Date('2026-11-13T00:00:00Z')
  const stockedInAt = new Date('2026-11-12T10:58:00Z')
  const ins = [{ optionId: 'o1', locationId: 'A', quantity: 50 }]
  const run = { stockedInAt, externalStockIns: ins }

  it('대조가 입고 이전이면 포함', () => {
    const m = pendingExternalQtyByOption(
      [run],
      new Map([['A', new Date('2026-11-12T10:56:00Z')]]),
      now
    )
    expect(m.get('o1')).toBe(50)
  })
  it('대조 기록이 없으면 포함', () => {
    expect(pendingExternalQtyByOption([run], new Map(), now).get('o1')).toBe(50)
  })
  it('입고 이후 확정 대조면 제외', () => {
    const m = pendingExternalQtyByOption(
      [run],
      new Map([['A', new Date('2026-11-13T00:00:00Z')]]),
      now
    )
    expect(m.size).toBe(0)
  })
  it('40일 전 입고는 제외', () => {
    const old = { stockedInAt: new Date('2026-10-04T00:00:00Z'), externalStockIns: ins }
    expect(pendingExternalQtyByOption([old], new Map(), now).size).toBe(0)
  })
  it('stockedInAt 없음·형식 오류 항목 무시', () => {
    const runs = [
      { stockedInAt: null, externalStockIns: ins },
      { stockedInAt, externalStockIns: 'bad' },
      {
        stockedInAt,
        externalStockIns: [
          { optionId: 'o1' },
          null,
          { optionId: 'o1', locationId: 'A', quantity: 'x' },
        ],
      },
    ]
    expect(pendingExternalQtyByOption(runs, new Map(), now).size).toBe(0)
  })
})

describe('loadReorderStockInputs', () => {
  beforeEach(() => jest.resetAllMocks())

  it('현재고·반품 차감·PLANNED 포함 incoming·외부 대기분', async () => {
    const now = new Date('2026-11-13T00:00:00Z')
    p.invStockLevel.groupBy.mockResolvedValue([
      { optionId: 'o1', locationId: 'R', _sum: { quantity: 100 } },
      { optionId: 'o1', locationId: 'H', _sum: { quantity: 20 } },
    ])
    p.invStorageLocation.findMany.mockResolvedValue([
      { id: 'R', type: 'OWN', externalSource: 'coupang_rocket_growth' },
      { id: 'H', type: 'OWN', externalSource: null },
    ])
    ;(getCoupangReturnStockByOption as jest.Mock).mockResolvedValue({
      locationId: 'R',
      snapshotDate: now,
      byOption: new Map([['o1', 30]]),
    })
    p.productionRun.findMany.mockResolvedValue([
      {
        status: 'PLANNED',
        stockedInAt: null,
        externalStockIns: null,
        items: [{ optionId: 'o1', quantity: 7 }],
      },
      {
        status: 'ORDERED',
        stockedInAt: null,
        externalStockIns: null,
        items: [{ optionId: 'o1', quantity: 3 }],
      },
      {
        status: 'STOCKED_IN',
        stockedInAt: new Date('2026-11-12T00:00:00Z'),
        externalStockIns: [{ optionId: 'o1', locationId: 'R', quantity: 40 }],
        items: [],
      },
    ])
    p.invReconciliation.findMany.mockResolvedValue([])

    const r = await loadReorderStockInputs('s1', ['o1'], now)
    expect(r.get('o1')).toEqual({
      onHandQty: 90,
      rocketOnHandQty: 70,
      incomingQty: 50,
      returnGradeQty: 30,
    })
  })
})
