/** @jest-environment node */
import { computeRuleUsage, matchingTexts, type MatchText } from '../rule-usage'

const t = (
  id: string,
  accountId: string,
  text: string,
  date: string,
  categoryId: string | null = null
): MatchText => ({
  id,
  accountId,
  direction: 'OUT',
  text,
  txnDate: new Date(date),
  categoryId,
})

describe('rule usage (텍스트 매칭 기준)', () => {
  const texts = [
    t('1', 'A', '쿠팡 결제', '2026-01-01', 'cat-x'),
    t('2', 'A', '쿠팡 결제', '2026-02-01', 'cat-y'),
    t('3', 'B', '쿠팡 결제', '2026-03-01', 'cat-x'),
    t('4', 'A', '네이버', '2026-04-01'),
  ]

  test('KEYWORD 규칙은 matchedRuleId 와 무관하게 포함 매칭으로 집계', () => {
    const usage = computeRuleUsage(
      [{ id: 'kw', accountId: null, matchKey: '쿠팡', matchType: 'KEYWORD', direction: 'OUT' }],
      texts
    )
    expect(usage.get('kw')).toEqual({ count: 3, lastMatchedAt: new Date('2026-03-01') })
  })

  test('계좌 전용 규칙은 그 계좌 거래만', () => {
    const usage = computeRuleUsage(
      [{ id: 'ex', accountId: 'A', matchKey: '쿠팡 결제', matchType: 'EXACT', direction: 'OUT' }],
      texts
    )
    expect(usage.get('ex')!.count).toBe(2)
  })

  test('매칭 없음 → count 0, lastMatchedAt null', () => {
    const usage = computeRuleUsage(
      [{ id: 'none', accountId: null, matchKey: '없음', matchType: 'EXACT', direction: null }],
      texts
    )
    expect(usage.get('none')).toEqual({ count: 0, lastMatchedAt: null })
  })

  test('matchingTexts 는 조건 범위의 거래 목록', () => {
    const rows = matchingTexts(
      { accountId: 'A', matchKey: '쿠팡', matchType: 'KEYWORD', direction: 'OUT' },
      texts
    )
    expect(rows.map((r) => r.id)).toEqual(['1', '2'])
  })
})
