import { computeEffectWindows, medianRank, NOT_IN_TOP_RANK } from '../change-effect'

describe('computeEffectWindows', () => {
  it('충분히 지난 변경은 14일 완결', () => {
    const w = computeEffectWindows('2026-10-01', '2026-10-18')
    expect(w.before).toEqual({ from: '2026-09-17', to: '2026-09-30' })
    expect(w.after).toEqual({ from: '2026-10-02', to: '2026-10-15' })
    expect(w.observedDays).toBe(14)
    expect(w.complete).toBe(true)
  })
  it('어제(마지막 집계일)에서 잘리면 관측 일수만큼', () => {
    const w = computeEffectWindows('2026-10-15', '2026-10-18')
    expect(w.after).toEqual({ from: '2026-10-16', to: '2026-10-18' })
    expect(w.observedDays).toBe(3)
    expect(w.complete).toBe(false)
  })
  it('변경 당일이 어제면 관측 0일', () => {
    const w = computeEffectWindows('2026-10-18', '2026-10-18')
    expect(w.observedDays).toBe(0)
    expect(w.complete).toBe(false)
  })
})

describe('medianRank', () => {
  it('빈 배열은 null', () => expect(medianRank([])).toBeNull())
  it('홀수·짝수', () => {
    expect(medianRank([5, 1, 3])).toBe(3)
    expect(medianRank([2, 4])).toBe(3)
  })
  it('100위 밖(101)이 섞여도 중앙값으로 처리', () => {
    expect(medianRank([10, NOT_IN_TOP_RANK, NOT_IN_TOP_RANK])).toBe(101)
    expect(medianRank([10, 20, NOT_IN_TOP_RANK])).toBe(20)
  })
})
