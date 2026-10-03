// 환불 집계 — 현금흐름 표·대시보드·Sankey·거래내역 합계가 같은 섹션 규칙(contra.ts)을 쓰는지
// 통제된 데이터로 검증(prisma는 mock).
//   매출 IN 100 + 매출환입 OUT 30 + 상품매입 OUT 50 + 광고비 OUT 20 + 광고비 환불 IN 10
//   → 수입 70 / 지출 60 / net 10 (순현금흐름은 방향 기준과 동일)

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
  ensureFinanceSeeded: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown) => ({ json: async () => body }) },
}))

import { queryCashflow, queryDashboard, queryTransactions } from '@/lib/finance/queries'
import { GET as sankeyGET } from '../../../../app/api/finance/cashflow/sankey/route'
import { cashSection, fixedSectionOf, isCategoryAllowedForDirection } from '@/lib/finance/contra'

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
  cat('l-refund', '매출환입(반품·환불)', 'INCOME', 'g-sales', { isContra: true }),
  cat('r-out', '지출', 'EXPENSE', null),
  cat('g-cogs', '상품원가', 'EXPENSE', 'r-out', { flowRole: 'COGS' }),
  cat('l-buy', '상품 매입·사입', 'EXPENSE', 'g-cogs'),
  cat('g-mkt', '마케팅·광고', 'EXPENSE', 'r-out', { flowRole: 'OPEX' }),
  cat('l-ad', '광고비', 'EXPENSE', 'g-mkt'),
]

const txn = (categoryId: string, direction: 'IN' | 'OUT', amount: number) => ({
  txnDate: new Date('2026-06-15T00:00:00.000Z'),
  direction,
  amount,
  isTransfer: false,
  cancelFlag: null,
  categoryId,
})
const TXNS = [
  txn('l-sales', 'IN', 100),
  txn('l-refund', 'OUT', 30),
  txn('l-buy', 'OUT', 50),
  txn('l-ad', 'OUT', 20),
  txn('l-ad', 'IN', 10),
]

beforeEach(() => {
  mockPrisma = {
    finCategory: {
      // loadFixedSections: where.OR=[{isContra},{type:'EXPENSE'}]
      findMany: jest.fn(async (args?: { where?: { OR?: unknown } }) =>
        args?.where?.OR ? CATS.filter((c) => c.isContra || c.type === 'EXPENSE') : CATS
      ),
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
          _sum: { amount: t.amount },
        }))
      ),
    },
    finAccount: { findMany: jest.fn(async () => []) },
    finBalanceSnapshot: { findMany: jest.fn(async () => []) },
    finLiability: { findMany: jest.fn(async () => []) },
  }
})

describe('contra 판정', () => {
  test('차감 계정은 계정 섹션에 반대 방향 음수', () => {
    expect(cashSection('OUT', 30, fixedSectionOf({ type: 'INCOME', isContra: true }))).toEqual({
      section: 'IN',
      amount: -30,
    })
    expect(cashSection('OUT', 30, fixedSectionOf({ type: 'INCOME' }))).toEqual({
      section: 'OUT',
      amount: 30,
    })
  })

  test('비용 계정은 환불 입금도 지출 섹션에서 음수', () => {
    expect(cashSection('IN', 10, fixedSectionOf({ type: 'EXPENSE' }))).toEqual({
      section: 'OUT',
      amount: -10,
    })
  })

  test('분류 가드: 일반 수익 계정은 OUT 차단, 차감 수익 계정은 OUT만 허용, 비용은 양방향', () => {
    expect(isCategoryAllowedForDirection({ type: 'EXPENSE' }, 'IN')).toBe(true)
    expect(isCategoryAllowedForDirection({ type: 'EXPENSE' }, 'OUT')).toBe(true)
    expect(isCategoryAllowedForDirection({ type: 'INCOME' }, 'OUT')).toBe(false)
    expect(isCategoryAllowedForDirection({ type: 'INCOME', isContra: true }, 'OUT')).toBe(true)
    expect(isCategoryAllowedForDirection({ type: 'INCOME', isContra: true }, 'IN')).toBe(false)
    expect(isCategoryAllowedForDirection({ type: 'EXPENSE', isContra: true }, 'IN')).toBe(true)
    expect(isCategoryAllowedForDirection({ type: 'TRANSFER' }, 'OUT')).toBe(true)
  })
})

describe('화면 간 수입/지출 일치', () => {
  test('현금흐름 표: 차감 계정이 자기 섹션에서 음수', async () => {
    const r = await queryCashflow('space-1', { grain: 'month', periods: ['2026-06'] })
    expect(r.totals.income.values['2026-06']).toBe(70)
    expect(r.totals.expense.values['2026-06']).toBe(60)
    expect(r.totals.net.values['2026-06']).toBe(10)
    const refund = r.incomeRows.find((x) => x.name === '매출환입(반품·환불)')
    expect(refund?.values['2026-06']).toBe(-30)
    expect(r.expenseRows.some((x) => x.name === '매출환입(반품·환불)')).toBe(false)
    // 광고비 환불 입금은 광고비 행에서 차감(수입 섹션에 '광고비' 행이 생기지 않음)
    expect(r.expenseRows.find((x) => x.name === '광고비')?.values['2026-06']).toBe(10)
    expect(r.incomeRows.some((x) => x.name === '광고비')).toBe(false)
    expect(r.metrics.revenue.values['2026-06']).toBe(70)
  })

  test('대시보드: 같은 합계', async () => {
    const r = await queryDashboard('space-1', { period: 'month', anchor: '2026-06' })
    expect(r.kpi.income).toBe(70)
    expect(r.kpi.expense).toBe(60)
    expect(r.kpi.net).toBe(10)
  })

  test('Sankey: 매출 70 · 원가 50 · 판관비 10 (환불이 각자 자리에서 차감)', async () => {
    const res = await sankeyGET({
      nextUrl: new URL('http://x/api/finance/cashflow/sankey?grain=month&period=2026-06'),
    } as Parameters<typeof sankeyGET>[0])
    const body = (await res!.json()) as { totals: Record<string, number> }
    expect(body.totals.merchSales).toBe(70)
    expect(body.totals.cogs).toBe(50)
    expect(body.totals.opex).toBe(10)
    expect(body.totals.totalIncome).toBe(70)
  })

  test('거래내역 합계 + direction=IN 필터가 매출환입 OUT 거래를 포함', async () => {
    const r = await queryTransactions('space-1', {
      direction: 'IN',
      order: 'desc',
      take: 50,
      skip: 0,
    })
    expect(r.summary).toEqual({ incomeTotal: 70, expenseTotal: 60, net: 10 })

    const where = mockPrisma.finTransaction.findMany.mock.calls[0][0].where
    expect(where.direction).toBeUndefined()
    const [sec] = where.AND
    // 일반 입금(섹션 고정 계정 제외) OR 매출환입
    expect(sec.OR[0].direction).toBe('IN')
    expect(sec.OR[0].OR[1].categoryId.notIn).toEqual(expect.arrayContaining(['l-refund', 'l-ad']))
    expect(sec.OR[1]).toEqual({ categoryId: { in: ['l-refund'] } })
  })

  test('direction=OUT 필터가 광고비 환불 IN 거래를 포함', async () => {
    await queryTransactions('space-1', { direction: 'OUT', order: 'desc', take: 50, skip: 0 })
    const [sec] = mockPrisma.finTransaction.findMany.mock.calls[0][0].where.AND
    expect(sec.OR[1].categoryId.in).toEqual(expect.arrayContaining(['l-ad', 'l-buy']))
    expect(sec.OR[1].categoryId.in).not.toContain('l-refund')
  })
})

describe('서버 방향 정책', () => {
  test('OUT→일반 수익 차단, 일반 비용 양방향(환불), 차감 계정은 반대 방향만', async () => {
    const { violatesDirectionPolicy } = await import('@/lib/finance/contra')
    expect(violatesDirectionPolicy({ type: 'INCOME' }, 'OUT')).toBe(true)
    expect(violatesDirectionPolicy({ type: 'EXPENSE' }, 'IN')).toBe(false)
    expect(violatesDirectionPolicy({ type: 'INCOME', isContra: true }, 'OUT')).toBe(false)
    expect(violatesDirectionPolicy({ type: 'INCOME', isContra: true }, 'IN')).toBe(true)
    expect(violatesDirectionPolicy({ type: 'EXPENSE', isContra: true }, 'OUT')).toBe(true)
  })

  test('loadSpaceRules: 차감 해제 후 남은 OUT→수익 규칙은 제외, IN→비용 규칙은 유지', async () => {
    mockPrisma.finClassRule = {
      findMany: jest.fn(async () => [
        {
          id: 'r1',
          matchKey: '환불',
          matchType: 'KEYWORD',
          categoryId: 'x',
          direction: 'OUT',
          memo: null,
          category: { type: 'INCOME', isContra: false },
        },
        {
          id: 'r2',
          matchKey: '환불',
          matchType: 'KEYWORD',
          categoryId: 'y',
          direction: 'IN',
          memo: null,
          category: { type: 'EXPENSE', isContra: false },
        },
        {
          id: 'r3',
          matchKey: '이체',
          matchType: 'KEYWORD',
          categoryId: 'z',
          direction: null,
          memo: null,
          category: { type: 'TRANSFER', isContra: false },
        },
      ]),
    }
    const { loadSpaceRules } = await import('@/lib/finance/classify')
    const rules = await loadSpaceRules('space-1')
    expect(rules.map((r) => r.id)).toEqual(['r2', 'r3'])
    expect(rules[0]).not.toHaveProperty('category')
  })
})
