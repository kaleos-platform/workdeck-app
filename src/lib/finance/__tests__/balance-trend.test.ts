/** @jest-environment node */
import {
  accountBalanceAt,
  avgCashBurn,
  avgMonthlyBurn,
  buildBalanceTrend,
  runwayLabel,
  runwayMonthsOf,
  type BalanceTrendInput,
} from '../balance-trend'

const base = (over: Partial<BalanceTrendInput> = {}): BalanceTrendInput => ({
  months: ['2026-08', '2026-09', '2026-10'],
  nowYm: '2026-10',
  bankAccounts: [
    { id: 'a', name: '주거래', status: 'ACTIVE', openingBalance: null },
    { id: 'z', name: '옛계좌', status: 'INACTIVE', openingBalance: null },
  ],
  accountSnaps: new Map([
    [
      'a',
      [
        { ym: '2026-08', balance: 1000 },
        { ym: '2026-10', balance: 1600 },
      ],
    ],
    [
      'z',
      [
        { ym: '2026-08', balance: 300 },
        { ym: '2026-09', balance: 0 },
      ],
    ],
  ]),
  liabilitySnaps: [{ liabilityId: 'L', name: '대출', ym: '2026-09', balance: 500 }],
  bankFlows: new Map([
    [
      'a',
      new Map([
        ['2026-08', 1000],
        ['2026-10', 600],
      ]),
    ],
    [
      'z',
      new Map([
        ['2026-08', 300],
        ['2026-09', -300],
      ]),
    ],
  ]),
  ...over,
})

describe('accountBalanceAt', () => {
  test('직전 스냅샷 이월 → 없으면 openingBalance → 없으면 0', () => {
    const snaps = [{ ym: '2026-08', balance: 10 }]
    expect(accountBalanceAt(snaps, '2026-09', 99)).toBe(10)
    expect(accountBalanceAt(snaps, '2026-07', 99)).toBe(99)
    expect(accountBalanceAt(undefined, '2026-07', null)).toBe(0)
  })
})

describe('avgMonthlyBurn / runwayMonthsOf', () => {
  test('지출 기록 없는 달은 평균에서 제외(0으로 묽히지 않음)', () => {
    const m = new Map([
      ['2026-07', 300],
      ['2026-08', 100],
    ])
    expect(avgMonthlyBurn(m, '2026-09')).toBe(200)
    expect(avgMonthlyBurn(m, '2026-12')).toBe(200) // 6개월 창
    expect(avgMonthlyBurn(m, '2027-03')).toBe(0)
  })
  test('avgCashBurn — 6개월 창, 데이터 시작 전으로 넘어가지 않음, 증가는 음수', () => {
    const cash: Record<string, number> = { '2026-01': 900, '2026-03': 1000, '2026-09': 400 }
    const cashAt = (ym: string) => cash[ym] ?? NaN
    expect(avgCashBurn(cashAt, '2026-09', '2026-01')).toBe(100) // 03→09, 6개월
    expect(avgCashBurn(cashAt, '2026-03', '2026-01')).toBe(-50) // 데이터 시작(01)부터 2개월
    expect(avgCashBurn(cashAt, '2026-01', '2026-01')).toBeNull()
    expect(avgCashBurn(cashAt, '2026-09', null)).toBeNull()
  })
  test('runwayLabel — 현금 증가면 소진 없음', () => {
    expect(runwayLabel(null, -10)).toBe('소진 없음')
    expect(runwayLabel(2.5, 100)).toBe('2.5개월')
    expect(runwayLabel(null, null)).toBe('—')
  })
  test('음수 잔액은 0개월, 지출 0이면 null', () => {
    expect(runwayMonthsOf(-50, 100)).toBe(0)
    expect(runwayMonthsOf(250, 100)).toBe(2.5)
    expect(runwayMonthsOf(250, 0)).toBeNull()
  })
})

describe('buildBalanceTrend', () => {
  const [aug, sep, oct] = buildBalanceTrend(base())

  test('현금 = 계좌 이월 합(미사용 계좌 과거 잔액 포함)', () => {
    expect(aug.cash).toBe(1300)
    expect(sep.cash).toBe(1000) // a 이월 1000 + z 0
    expect(oct.cash).toBe(1600)
    expect(sep.cashDelta).toBe(-300)
  })

  test('부채 추적 시작 전 달은 부채·순자산 null', () => {
    expect(aug.liability).toBeNull()
    expect(aug.netWorth).toBeNull()
    expect(sep.liability).toBe(500)
    expect(sep.netWorth).toBe(500)
    expect(sep.netWorthDelta).toBeNull() // 직전 달 부채 미상
    expect(oct.netWorthDelta).toBe(600)
  })

  test('이월 경고는 사용 중 계좌만, 미사용 계좌는 잔액 0인 달 하위 행에서 숨김', () => {
    expect(sep.carried).toEqual([{ accountId: 'a', name: '주거래', fromYm: '2026-08' }])
    expect(aug.accounts.map((a) => a.id)).toEqual(['a', 'z'])
    expect(sep.accounts.map((a) => a.id)).toEqual(['a'])
  })

  test('버틸 개월수 — 실제 현금 감소 기준, 진행 중 달은 직전 완결 월까지', () => {
    expect(aug.runwayMonths).toBeNull() // 데이터 첫 달 — 비교할 이전 달 없음
    expect(sep.cashBurn).toBe(300) // 1300 → 1000
    expect(sep.runwayMonths).toBeCloseTo(1000 / 300, 1)
    expect(oct.inProgress).toBe(true)
    expect(oct.runwayMonths).toBeCloseTo(1600 / 300, 1)
  })

  test('잔액 체인 정합성 — 계좌별 잔액 증감과 거래 순액 차이', () => {
    // 8월은 기초잔액 없는 첫 데이터 달 → 시작 잔액을 차이로 보지 않는다
    expect(aug.flowGap).toBe(0)
    expect(sep.flowGap).toBe(0)
    expect(oct.flowGap).toBe(0)
    const [, gapSep] = buildBalanceTrend(base({ bankFlows: new Map([['z', new Map()]]) }))
    expect(gapSep.flowGap).toBe(-300)
  })

  test('기초잔액이 있어도 첫 데이터 달은 체인 차이에서 제외', () => {
    const [first] = buildBalanceTrend(
      base({
        bankAccounts: [{ id: 'a', name: '주거래', status: 'ACTIVE', openingBalance: 50 }],
      })
    )
    expect(first.ym).toBe('2026-08')
    expect(first.flowGap).toBe(0)
  })

  test('잔액을 아는 계좌가 없는 앞쪽 달은 행 생략', () => {
    const rows = buildBalanceTrend(base({ months: ['2026-06', '2026-07', '2026-08'] }))
    expect(rows.map((r) => r.ym)).toEqual(['2026-08'])
  })

  test('부채 스냅샷이 전혀 없으면 이번 달부터 0', () => {
    const rows = buildBalanceTrend(base({ liabilitySnaps: [] }))
    expect(rows.map((r) => r.liability)).toEqual([null, null, 0])
  })
})
