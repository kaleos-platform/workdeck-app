/** @jest-environment node */
import {
  ymOf,
  addMonths,
  monthList,
  signedAmount,
  aggregateByMonth,
  aggregateExpenseByCategory,
  aggregateIncomeByCategory,
  type AggRow,
} from '../aggregate'

// 로컬 시간대 기준 Date 생성(월 경계는 로컬로 계산됨)
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day)

describe('월 유틸', () => {
  test('ymOf — 로컬 연-월', () => {
    expect(ymOf(d(2026, 3, 15))).toBe('2026-03')
    expect(ymOf(d(2026, 12, 1))).toBe('2026-12')
  })

  test('addMonths — 연 경계 wraparound', () => {
    expect(addMonths('2026-01', -2)).toBe('2025-11')
    expect(addMonths('2026-11', 3)).toBe('2027-02')
    expect(addMonths('2026-06', 0)).toBe('2026-06')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
  })

  test('monthList — 포함 범위', () => {
    expect(monthList('2026-01', '2026-03')).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(monthList('2025-12', '2026-02')).toEqual(['2025-12', '2026-01', '2026-02'])
    expect(monthList('2026-05', '2026-05')).toEqual(['2026-05'])
  })
})

describe('취소 부호', () => {
  test('취소 행은 음수', () => {
    expect(signedAmount({ amount: 1000, cancelFlag: '취소' })).toBe(-1000)
    expect(signedAmount({ amount: 1000, cancelFlag: '정상' })).toBe(1000)
    expect(signedAmount({ amount: 1000, cancelFlag: null })).toBe(1000)
  })
})

describe('월별 집계', () => {
  const rows: AggRow[] = [
    { txnDate: d(2026, 3, 1), direction: 'IN', amount: 5000, isTransfer: false },
    { txnDate: d(2026, 3, 5), direction: 'OUT', amount: 2000, isTransfer: false },
    {
      txnDate: d(2026, 3, 9),
      direction: 'OUT',
      amount: 500,
      isTransfer: false,
      cancelFlag: '취소',
    }, // 환불 상계
    { txnDate: d(2026, 3, 12), direction: 'OUT', amount: 9999, isTransfer: true }, // 이체 제외
    { txnDate: d(2026, 4, 1), direction: 'IN', amount: 3000, isTransfer: false },
  ]

  test('이체 제외 + 취소 상계', () => {
    const agg = aggregateByMonth(rows)
    expect(agg.get('2026-03')).toEqual({ income: 5000, expense: 1500 }) // 2000 - 500
    expect(agg.get('2026-04')).toEqual({ income: 3000, expense: 0 })
  })

  test('계정과목별 지출/수입 — 이체 제외, null은 __none', () => {
    const catRows: AggRow[] = [
      {
        txnDate: d(2026, 3, 1),
        direction: 'OUT',
        amount: 1000,
        isTransfer: false,
        categoryId: 'c1',
      },
      {
        txnDate: d(2026, 3, 2),
        direction: 'OUT',
        amount: 500,
        isTransfer: false,
        categoryId: 'c1',
      },
      {
        txnDate: d(2026, 3, 3),
        direction: 'OUT',
        amount: 700,
        isTransfer: false,
        categoryId: null,
      },
      {
        txnDate: d(2026, 3, 4),
        direction: 'OUT',
        amount: 9999,
        isTransfer: true,
        categoryId: 'c2',
      },
      {
        txnDate: d(2026, 3, 5),
        direction: 'IN',
        amount: 8000,
        isTransfer: false,
        categoryId: 'i1',
      },
    ]
    const exp = aggregateExpenseByCategory(catRows)
    expect(exp.get('c1')).toBe(1500)
    expect(exp.get('__none')).toBe(700)
    expect(exp.has('c2')).toBe(false) // 이체 제외
    expect(exp.has('i1')).toBe(false) // 수입 제외

    const inc = aggregateIncomeByCategory(catRows)
    expect(inc.get('i1')).toBe(8000)
    expect(inc.has('c1')).toBe(false)
  })
})
