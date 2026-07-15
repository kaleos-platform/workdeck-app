// cashflow route 통합 — 실제 queryCashflow 배선(levelOne→flowRole, leaf groupLabel→computePnlMetrics)을
// 통제된 카테고리 트리/거래로 검증(prisma는 mock). exclude 파라미터·손익 지표 산출 확인.

// eslint-disable-next-line no-var
var mockFin: { finTransaction: { findMany: jest.Mock }; finCategory: { findMany: jest.Mock } }

function ensureMock() {
  if (!mockFin) {
    mockFin = {
      finTransaction: { findMany: jest.fn() },
      finCategory: { findMany: jest.fn() },
    }
  }
  return mockFin
}

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn().mockResolvedValue({ space: { id: 'space-1' } }),
}))

jest.mock('@/lib/finance/kifrs-seed', () => ({
  ensureFinanceSeeded: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/prisma', () => ({
  get prisma() {
    return ensureMock()
  },
}))

import { GET } from '../route'

// 트리: 수입>매출(MERCH_SALES)>상품매출 · 지출>매출원가(COGS)>[변동] · 지출>영업비용(OPEX)>[변동,고정]
const CATEGORIES = [
  { id: 'r-in', name: '수입', type: 'INCOME', parentId: null, groupLabel: null, flowRole: null },
  {
    id: 'g-sales',
    name: '매출',
    type: 'INCOME',
    parentId: 'r-in',
    groupLabel: null,
    flowRole: 'MERCH_SALES',
  },
  {
    id: 'l-sales',
    name: '상품매출',
    type: 'INCOME',
    parentId: 'g-sales',
    groupLabel: null,
    flowRole: null,
  },
  { id: 'r-out', name: '지출', type: 'EXPENSE', parentId: null, groupLabel: null, flowRole: null },
  {
    id: 'g-cogs',
    name: '매출원가',
    type: 'EXPENSE',
    parentId: 'r-out',
    groupLabel: null,
    flowRole: 'COGS',
  },
  {
    id: 'l-cogs-v',
    name: '상품매입',
    type: 'EXPENSE',
    parentId: 'g-cogs',
    groupLabel: '변동',
    flowRole: null,
  },
  {
    id: 'g-opex',
    name: '영업비용',
    type: 'EXPENSE',
    parentId: 'r-out',
    groupLabel: null,
    flowRole: 'OPEX',
  },
  {
    id: 'l-opex-v',
    name: '택배비',
    type: 'EXPENSE',
    parentId: 'g-opex',
    groupLabel: '변동',
    flowRole: null,
  },
  {
    id: 'l-opex-f',
    name: '임차료',
    type: 'EXPENSE',
    parentId: 'g-opex',
    groupLabel: '고정',
    flowRole: null,
  },
]

const D = (ym: string) => new Date(`${ym}-15T00:00:00.000Z`)
const txn = (categoryId: string, direction: 'IN' | 'OUT', amount: number, ym = '2026-06') => ({
  txnDate: D(ym),
  direction,
  amount,
  isTransfer: false,
  cancelFlag: null,
  categoryId,
})

function req(qs: string) {
  return { nextUrl: new URL(`http://x/api/finance/cashflow?${qs}`) } as Parameters<typeof GET>[0]
}

describe('/api/finance/cashflow metrics', () => {
  beforeEach(() => {
    const m = ensureMock()
    m.finTransaction.findMany.mockReset()
    m.finCategory.findMany.mockReset()
    m.finCategory.findMany.mockResolvedValue(CATEGORIES)
  })

  test('손익 지표 산출: flowRole+groupLabel 기반', async () => {
    ensureMock().finTransaction.findMany.mockResolvedValue([
      txn('l-sales', 'IN', 1000),
      txn('l-cogs-v', 'OUT', 400), // 매출원가·변동
      txn('l-opex-v', 'OUT', 100), // 영업비용·변동
      txn('l-opex-f', 'OUT', 200), // 영업비용·고정
    ])
    const res = (await GET(req('grain=month&periods=2026-06')))!
    const body = await res.json()
    const m = body.metrics
    expect(m.revenue.total).toBe(1000)
    expect(m.cogs.total).toBe(400)
    expect(m.opex.total).toBe(300)
    expect(m.variableCost.total).toBe(500) // 400+100
    expect(m.grossProfit.total).toBe(600) // 1000-400
    expect(m.contributionMargin.total).toBe(500) // 1000-500
    expect(m.contributionMarginRatio.total).toBe(50)
    expect(m.operatingIncome.total).toBe(300) // 1000-400-300
    expect(m.breakEvenSales.total).toBe(400) // 고정비200 / 0.5
    // 제외 필터 UI용 리프 카탈로그
    expect(body.leafOptions.map((o: { id: string }) => o.id)).toEqual(
      expect.arrayContaining(['l-sales', 'l-cogs-v', 'l-opex-v', 'l-opex-f'])
    )
    expect(body.leafOptions.map((o: { id: string }) => o.id)).not.toContain('g-cogs')
  })

  test('exclude: 지정 리프는 표·지표에서 제외', async () => {
    ensureMock().finTransaction.findMany.mockResolvedValue([
      txn('l-sales', 'IN', 1000),
      txn('l-cogs-v', 'OUT', 400),
      txn('l-opex-v', 'OUT', 100),
    ])
    const res = (await GET(req('grain=month&periods=2026-06&exclude=l-opex-v')))!
    const body = await res.json()
    expect(body.metrics.opex.total).toBe(0) // 택배비 제외
    expect(body.metrics.variableCost.total).toBe(400) // 100 빠짐
    expect(body.exclude).toEqual(['l-opex-v'])
    // 지출 행에도 택배비 없음
    const expenseIds = body.expenseRows.map((r: { name: string }) => r.name)
    expect(expenseIds).not.toContain('택배비')
  })
})
