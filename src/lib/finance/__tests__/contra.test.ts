// 환불 집계 — 현금흐름 표·대시보드·Sankey·거래내역 합계가 같은 섹션 규칙(contra.ts)을 쓰는지
// 통제된 데이터로 검증(prisma는 mock).
//   매출 IN 100 + 매출 환불 OUT 30(원래 매출 계정) + 상품매입 OUT 50 + 광고비 OUT 20 + 광고비 환급 IN 10
//   + 광고비 카드 취소 OUT 5 → 수입 70 / 지출 55 / net 15 (순현금흐름은 방향 기준과 동일)

// eslint-disable-next-line no-var
var mockPrisma: Record<string, Record<string, jest.Mock>>

jest.mock('@/lib/prisma', () => ({
  get prisma() {
    return mockPrisma
  },
}))
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn().mockResolvedValue({ space: { id: 'space-1' } }),
}))
jest.mock('@/lib/finance/kifrs-seed', () => ({
  ...jest.requireActual('@/lib/finance/kifrs-seed'),
  ensureFinanceSeeded: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown) => ({ json: async () => body }) },
}))

import { queryCashflow, queryDashboard, queryTransactions } from '@/lib/finance/queries'
import { GET as sankeyGET } from '../../../../app/api/finance/cashflow/sankey/route'
import { cashSection, fixedSectionOf } from '@/lib/finance/contra'

const cat = (
  id: string,
  name: string,
  type: string,
  parentId: string | null,
  extra: { flowRole?: string; isContra?: boolean } = {}
) => ({
  id,
  name,
  type,
  parentId,
  groupLabel: null,
  flowRole: extra.flowRole ?? null,
  isContra: extra.isContra ?? false,
})

const CATS = [
  cat('r-in', '수입', 'INCOME', null),
  cat('g-sales', '매출', 'INCOME', 'r-in', { flowRole: 'MERCH_SALES' }),
  cat('l-sales', '온라인 판매정산', 'INCOME', 'g-sales'),
  cat('r-out', '지출', 'EXPENSE', null),
  cat('g-cogs', '상품원가', 'EXPENSE', 'r-out', { flowRole: 'COGS' }),
  cat('l-buy', '상품 매입·사입', 'EXPENSE', 'g-cogs'),
  cat('g-mkt', '마케팅·광고', 'EXPENSE', 'r-out', { flowRole: 'OPEX' }),
  cat('l-ad', '광고비', 'EXPENSE', 'g-mkt'),
]

const txn = (
  categoryId: string,
  direction: 'IN' | 'OUT',
  amount: number,
  cancelFlag: string | null = null
) => ({
  txnDate: new Date('2026-06-15T00:00:00.000Z'),
  direction,
  amount,
  isTransfer: false,
  cancelFlag,
  categoryId,
})
const TXNS = [
  txn('l-sales', 'IN', 100),
  txn('l-sales', 'OUT', 30),
  txn('l-buy', 'OUT', 50),
  txn('l-ad', 'OUT', 20),
  txn('l-ad', 'IN', 10),
  txn('l-ad', 'OUT', 5, '취소'), // 카드 취소 — 상계(지출 −5)
]

beforeEach(() => {
  mockPrisma = {
    finCategory: {
      // loadFixedSections: where.type in [INCOME, EXPENSE]
      findMany: jest.fn(async (args?: { where?: { type?: unknown } }) =>
        args?.where?.type ? CATS.filter((c) => c.type === 'INCOME' || c.type === 'EXPENSE') : CATS
      ),
      findUnique: jest.fn(),
    },
    finTransaction: {
      findMany: jest.fn(async (args?: { where?: { liabilityId?: unknown } }) =>
        args?.where?.liabilityId ? [] : TXNS
      ),
      count: jest.fn(async () => TXNS.length),
      groupBy: jest.fn(async () =>
        TXNS.map((t) => ({
          direction: t.direction,
          categoryId: t.categoryId,
          cancelFlag: t.cancelFlag,
          _sum: { amount: t.amount },
        }))
      ),
    },
    finAccount: { findMany: jest.fn(async () => []) },
    finBalanceSnapshot: { findMany: jest.fn(async () => []) },
    finLiability: { findMany: jest.fn(async () => []) },
  }
})

describe('섹션 판정', () => {
  test('수익 계정 출금(고객 환불)은 수입 섹션에서 음수', () => {
    expect(cashSection('OUT', 30, fixedSectionOf({ type: 'INCOME' }))).toEqual({
      section: 'IN',
      amount: -30,
    })
  })

  test('비용 계정 입금(환급)은 지출 섹션에서 음수', () => {
    expect(cashSection('IN', 10, fixedSectionOf({ type: 'EXPENSE' }))).toEqual({
      section: 'OUT',
      amount: -10,
    })
  })

  test('이체·미분류는 현금 방향', () => {
    expect(fixedSectionOf({ type: 'TRANSFER' })).toBeNull()
    expect(cashSection('OUT', 5, fixedSectionOf(null))).toEqual({ section: 'OUT', amount: 5 })
  })
})

describe('화면 간 수입/지출 일치', () => {
  test('현금흐름 표: 환불이 원래 계정 행에서 차감', async () => {
    const r = await queryCashflow('space-1', { grain: 'month', periods: ['2026-06'] })
    expect(r.totals.income.values['2026-06']).toBe(70)
    expect(r.totals.expense.values['2026-06']).toBe(55)
    expect(r.totals.net.values['2026-06']).toBe(15)
    // 매출 환불 출금은 판매정산 행에서 차감(지출 섹션에 '판매정산' 행이 생기지 않음)
    expect(r.incomeRows.find((x) => x.name === '온라인 판매정산')?.values['2026-06']).toBe(70)
    expect(r.expenseRows.some((x) => x.name === '온라인 판매정산')).toBe(false)
    // 광고비 환불 입금은 광고비 행에서 차감(수입 섹션에 '광고비' 행이 생기지 않음)
    expect(r.expenseRows.find((x) => x.name === '광고비')?.values['2026-06']).toBe(5)
    expect(r.incomeRows.some((x) => x.name === '광고비')).toBe(false)
    expect(r.metrics.revenue.values['2026-06']).toBe(70)
  })

  test('대시보드: 같은 합계', async () => {
    const r = await queryDashboard('space-1', { period: 'month', anchor: '2026-06' })
    expect(r.kpi.income).toBe(70)
    expect(r.kpi.expense).toBe(55)
    expect(r.kpi.net).toBe(15)
  })

  test('Sankey: 매출 70 · 원가 50 · 판관비 5 (환불·취소가 각자 자리에서 차감)', async () => {
    const res = await sankeyGET({
      nextUrl: new URL('http://x/api/finance/cashflow/sankey?grain=month&period=2026-06'),
    } as Parameters<typeof sankeyGET>[0])
    const body = (await res!.json()) as { totals: Record<string, number> }
    expect(body.totals.merchSales).toBe(70)
    expect(body.totals.cogs).toBe(50)
    expect(body.totals.opex).toBe(5)
    expect(body.totals.totalIncome).toBe(70)
  })

  test('거래내역 합계 + direction=IN 필터가 매출 환불 OUT 거래를 포함', async () => {
    const r = await queryTransactions('space-1', {
      direction: 'IN',
      order: 'desc',
      take: 50,
      skip: 0,
    })
    // 카드 취소까지 현금흐름 표와 같은 규칙(취소 상계)
    expect(r.summary).toEqual({ incomeTotal: 70, expenseTotal: 55, net: 15 })

    const where = mockPrisma.finTransaction.findMany.mock.calls[0][0].where
    expect(where.direction).toBeUndefined()
    const [sec] = where.AND
    // 미분류·이체 입금 OR 수익 계정(방향 무관)
    expect(sec.OR[0].direction).toBe('IN')
    expect(sec.OR[0].OR[1].categoryId.notIn).toEqual(expect.arrayContaining(['l-sales', 'l-ad']))
    expect(sec.OR[1].categoryId.in).toContain('l-sales')
    expect(sec.OR[1].categoryId.in).not.toContain('l-ad')
  })

  test('direction=OUT 필터가 광고비 환불 IN 거래를 포함', async () => {
    await queryTransactions('space-1', { direction: 'OUT', order: 'desc', take: 50, skip: 0 })
    const [sec] = mockPrisma.finTransaction.findMany.mock.calls[0][0].where.AND
    expect(sec.OR[1].categoryId.in).toEqual(expect.arrayContaining(['l-ad', 'l-buy']))
    expect(sec.OR[1].categoryId.in).not.toContain('l-sales')
  })
})

describe('환불은 규칙 학습·자동분류에서 제외', () => {
  test('loadSpaceRules: 계정 섹션과 반대 방향 규칙 제외', async () => {
    const rule = (id: string, direction: string | null, type: string) => ({
      id,
      matchKey: 'k',
      matchType: 'KEYWORD',
      categoryId: id,
      direction,
      memo: null,
      category: { type },
    })
    mockPrisma.finClassRule = {
      findMany: jest.fn(async () => [
        rule('out-income', 'OUT', 'INCOME'),
        rule('in-expense', 'IN', 'EXPENSE'),
        rule('in-income', 'IN', 'INCOME'),
        rule('out-expense', 'OUT', 'EXPENSE'),
        rule('transfer', null, 'TRANSFER'),
      ]),
    }
    const { loadSpaceRules } = await import('@/lib/finance/classify')
    const rules = await loadSpaceRules('space-1')
    expect(rules.map((r) => r.id)).toEqual(['in-income', 'out-expense', 'transfer'])
    expect(rules[0]).not.toHaveProperty('category')
  })

  test('learnRule: 환불 분류는 학습하지 않음, 정상 방향은 학습', async () => {
    const upsert = jest.fn(async () => ({ id: 'rule-1' }))
    mockPrisma.finClassRule = { upsert }
    const { learnRule } = await import('@/lib/finance/classify')
    mockPrisma.finCategory.findUnique.mockResolvedValueOnce({ type: 'INCOME' })
    expect(await learnRule('space-1', { description: '홍길동 환불' }, 'l-sales', 'OUT')).toBeNull()
    expect(upsert).not.toHaveBeenCalled()
    mockPrisma.finCategory.findUnique.mockResolvedValueOnce({ type: 'INCOME' })
    expect(await learnRule('space-1', { description: '쿠팡 정산' }, 'l-sales', 'IN')).toBe('rule-1')
  })
})
