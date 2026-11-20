import { isReconciledAfter, isReconciledSameDay, type StockInFacts } from '../production-stock-in'

const facts = (at: Date | null, own = true): StockInFacts => ({
  registered: new Map(),
  lastReconAtByLocation: at ? new Map([['office', at]]) : new Map(),
  ownLocationIds: own ? new Set(['office']) : new Set(),
})
const stockedInAt = new Date('2026-11-20T00:00:00Z') // 입고일 11-20

describe('isReconciledSameDay', () => {
  it('입고일과 같은 KST 날짜 대조면 true, 이후 대조로는 보지 않는다', () => {
    const f = facts(new Date('2026-11-20T05:00:00Z')) // KST 11-20 14:00
    expect(isReconciledSameDay(f, 'office', stockedInAt)).toBe(true)
    expect(isReconciledAfter(f, 'office', stockedInAt)).toBe(false)
  })
  it('다음 날(KST) 대조는 같은 날이 아니라 이후 대조', () => {
    const f = facts(new Date('2026-11-20T16:00:00Z')) // KST 11-21 01:00
    expect(isReconciledSameDay(f, 'office', stockedInAt)).toBe(false)
    expect(isReconciledAfter(f, 'office', stockedInAt)).toBe(true)
  })
  it('대조 없음·외부 위치는 false', () => {
    expect(isReconciledSameDay(facts(null), 'office', stockedInAt)).toBe(false)
    expect(
      isReconciledSameDay(facts(new Date('2026-11-20T05:00:00Z'), false), 'office', stockedInAt)
    ).toBe(false)
  })
})
