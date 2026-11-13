import { backtestProduct, recommendModel } from '../backtest'
import type { DayPoint } from '../series'

const mk = (qtys: number[]): DayPoint[] =>
  qtys.map((qty, i) => ({ date: `d${i}`, qty, stockout: false }))

describe('backtestProduct', () => {
  const series = mk([...Array(60).fill(1), ...Array(60).fill(3)])

  it('최근 평균 MA30 이 MA90 보다 오차가 작다', () => {
    const bt = backtestProduct([series], 30)
    expect(bt.MA30!).toBeLessThan(bt.MA90!)
    const { model, scores } = recommendModel(bt)
    expect(scores.MA90!).toBeGreaterThan(scores.MA30!)
    expect(['MA30', 'SES_TREND']).toContain(model)
  })

  it('학습 구간 30일 미만이면 전부 null, 추천 MA_BLEND', () => {
    const bt = backtestProduct([mk(Array(40).fill(2))], 30)
    expect(Object.values(bt).every((v) => v === null)).toBe(true)
    expect(recommendModel(bt).model).toBe('MA_BLEND')
  })

  it('실제합 0 이면 null', () => {
    expect(backtestProduct([mk(Array(120).fill(0))], 30).MA30).toBeNull()
  })

  it('realized 는 백테스트와 평균', () => {
    const bt = backtestProduct([series], 30)
    const { scores } = recommendModel(bt, { MA90: 0, USER: 0 })
    expect(scores.MA90).toBeCloseTo(bt.MA90! / 2)
  })
})
