import { backtestProduct, MODEL_SWITCH_MARGIN, recommendModel } from '../backtest'
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
    expect(scores.MA_BLEND! - scores[model]!).toBeGreaterThanOrEqual(MODEL_SWITCH_MARGIN)
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

describe('recommendModel — 교체 임계값(5%p)', () => {
  const bt = (over: Partial<Record<string, number | null>>) => ({
    MA30: 0.5,
    MA90: 0.5,
    MA_BLEND: 0.3,
    SES_TREND: 0.5,
    CROSTON: 0.5,
    ...over,
  })

  it('1위가 MA_BLEND 보다 5%p 미만 낮으면 MA_BLEND 유지', () => {
    expect(recommendModel(bt({ CROSTON: 0.26 })).model).toBe('MA_BLEND')
    expect(recommendModel(bt({ MA90: 0.2501 })).model).toBe('MA_BLEND')
  })

  it('5%p 이상 낮으면 1위로 교체', () => {
    expect(recommendModel(bt({ CROSTON: 0.25 })).model).toBe('CROSTON')
    expect(recommendModel(bt({ SES_TREND: 0.1 })).model).toBe('SES_TREND')
  })

  it('실적이 섞인 점수에도 같은 기준을 적용하고 scores 는 그대로 돌려준다', () => {
    // CROSTON 백테스트 0.2 지만 실적 0.36 → 평균 0.28, MA_BLEND 0.3 과 2%p 차 → 유지
    const r = recommendModel(bt({ CROSTON: 0.2 }), { CROSTON: 0.36 })
    expect(r.model).toBe('MA_BLEND')
    expect(r.scores.CROSTON).toBeCloseTo(0.28)
  })

  it('MA_BLEND 점수가 없으면 최소 점수 모델', () => {
    expect(recommendModel(bt({ MA_BLEND: null, MA90: 0.49 })).model).toBe('MA90')
  })
})
