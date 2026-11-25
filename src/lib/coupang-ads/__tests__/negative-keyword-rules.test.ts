import {
  classifyKeywords,
  negativeKeywordWindow,
  type KeywordAggRow,
  type KeywordStatusRow,
} from '../negative-keyword-rules'

const NOW = new Date('2026-11-25T03:00:00Z') // KST 12:00
const row = (over: Partial<KeywordAggRow> = {}): KeywordAggRow => ({
  campaignId: 'c1',
  keyword: 'kw',
  adCost30: 10_000,
  clicks30: 10,
  orders30: 0,
  lastSpendDate: '2026-11-20',
  adCost90: 10_000,
  orders90: 0,
  revenue90: 0,
  ...over,
})
const status = (over: Partial<KeywordStatusRow>): KeywordStatusRow => ({
  campaignId: 'c1',
  keyword: 'kw',
  removedAt: null,
  dismissedUntil: null,
  ...over,
})
const names = new Map([['c1', '캠페인1']])
const run = (rows: KeywordAggRow[], statuses: KeywordStatusRow[] = []) =>
  classifyKeywords(rows, statuses, names, NOW)

describe('classifyKeywords', () => {
  it('광고비·클릭 경계값: 9,999원/클릭 9 는 제외, 10,000원·클릭 10 은 후보', () => {
    const [c] = run([
      row({ keyword: 'ok' }),
      row({ keyword: 'cost', adCost30: 9_999 }),
      row({ keyword: 'click', clicks30: 9 }),
    ])
    expect(c.campaignName).toBe('캠페인1')
    expect(c.candidates.map((k) => k.keyword)).toEqual(['ok'])
    expect(c.protected).toEqual([])
  })

  it('30일 주문이 있으면 후보도 보호도 아님', () => {
    const [c] = run([row({ orders30: 1, orders90: 1 })])
    expect(c.candidates).toEqual([])
    expect(c.protected).toEqual([])
  })

  it('90일 주문이 있으면 보호(ROAS 포함)', () => {
    const [c] = run([row({ orders90: 2, revenue90: 30_000, adCost90: 20_000 })])
    expect(c.candidates).toEqual([])
    expect(c.protected[0]).toMatchObject({ keyword: 'kw', orders90: 2, roas90: 150 })
  })

  it('제거 표시된 키워드는 후보에서 빠지고 removedCount 에 들어감', () => {
    const [c] = run([row()], [status({ removedAt: new Date('2026-11-01') })])
    expect(c.candidates).toEqual([])
    expect(c.removedCount).toBe(1)
  })

  it('「제외 안 함」 기간이 미래면 숨김, 과거면 다시 후보', () => {
    expect(
      run([row()], [status({ dismissedUntil: new Date('2026-12-01') })])[0].candidates
    ).toEqual([])
    expect(
      run([row()], [status({ dismissedUntil: new Date('2026-11-24') })])[0].candidates
    ).toHaveLength(1)
  })

  it('다른 캠페인의 상태는 영향 없음', () => {
    const [c] = run([row()], [status({ campaignId: 'c2', removedAt: new Date() })])
    expect(c.candidates).toHaveLength(1)
    expect(c.removedCount).toBe(0)
  })

  it('캠페인은 후보 광고비 합 내림차순, 후보는 광고비 내림차순', () => {
    const list = run([
      row({ campaignId: 'c2', keyword: 'a', adCost30: 12_000 }),
      row({ keyword: 'b', adCost30: 11_000 }),
      row({ keyword: 'c', adCost30: 20_000 }),
    ])
    expect(list.map((c) => c.campaignId)).toEqual(['c1', 'c2'])
    expect(list[0].candidates.map((k) => k.keyword)).toEqual(['c', 'b'])
    expect(list[1].campaignName).toBe('c2') // 이름 없으면 ID
  })
})

describe('negativeKeywordWindow', () => {
  it('end = 오늘 00:00 KST, 30·90일 전 시작', () => {
    const w = negativeKeywordWindow(NOW)
    expect(w.end.toISOString()).toBe('2026-11-24T15:00:00.000Z')
    expect(w.start30.toISOString()).toBe('2026-10-25T15:00:00.000Z')
    expect(w.start90.toISOString()).toBe('2026-08-26T15:00:00.000Z')
  })

  it('KST 자정 직후(UTC 전날 15:00)는 KST 날짜 기준', () => {
    const w = negativeKeywordWindow(new Date('2026-11-24T15:00:00Z'))
    expect(w.end.toISOString()).toBe('2026-11-24T15:00:00.000Z')
  })
})
