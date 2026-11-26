import { forecastRates } from '../models'
import type { DayPoint } from '../series'

const series = (qty: number[]): DayPoint[] =>
  qty.map((value, i) => ({ date: `d${i}`, qty: value, stockout: false }))

describe('SES_TREND 과다 예측 상한', () => {
  it('마지막 며칠 판매가 튀어도 최근 비품절 평균 2배로 제한한다', () => {
    const rates = forecastRates(series([...Array(85).fill(0.8), ...Array(5).fill(6)]), 50)

    expect(rates.SES_TREND).toBeCloseTo(2 * ((25 * 0.8 + 5 * 6) / 30), 10)
  })

  it('90 관측일 평균이 더 크면 그 평균을 상한 기준으로 쓴다', () => {
    const rates = forecastRates(
      series([...Array(60).fill(4), ...Array(25).fill(0.8), ...Array(5).fill(6)]),
      50
    )

    expect(rates.SES_TREND).toBeCloseTo(2 * ((60 * 4 + 25 * 0.8 + 5 * 6) / 90), 10)
  })

  it('평평한 수요는 기존 Holt 예측을 유지한다', () => {
    expect(forecastRates(series(Array(90).fill(2)), 50).SES_TREND).toBeCloseTo(2, 10)
  })

  it('상한 아래 완만한 증가도 기존 Holt 예측을 유지한다', () => {
    const rates = forecastRates(series(Array.from({ length: 90 }, (_, i) => 2 + i * 0.01)), 50)

    // 선형 수요의 마지막 값 2.89 + 1..50일 평균 증가분 0.255
    expect(rates.SES_TREND).toBeCloseTo(3.145, 10)
  })

  it('최근 90일이 모두 품절이어도 과거 유효 수요를 지우지 않는다', () => {
    const history = [
      ...series(Array(30).fill(2)),
      ...series(Array(90).fill(0)).map((p) => ({ ...p, stockout: true })),
    ]
    const rates = forecastRates(history, 50)

    expect(rates.SES_TREND).toBeCloseTo(2, 10)
    expect(rates.MA30).toBe(0)
    expect(rates.MA90).toBe(0)
  })

  it('품절일을 상한 평균의 분모에서도 제외한다', () => {
    const history = series([...Array(85).fill(0.8), ...Array(5).fill(6)]).flatMap((p) => [
      p,
      { ...p, qty: 0, stockout: true },
    ])

    expect(forecastRates(history, 50).SES_TREND).toBeCloseTo(2 * ((25 * 0.8 + 5 * 6) / 30), 10)
  })

  it('다른 네 모델의 예측은 바꾸지 않는다', () => {
    const { SES_TREND, ...rates } = forecastRates(
      series([...Array(30).fill(4), ...Array(60).fill(1)]),
      50
    )

    expect(SES_TREND).toBeGreaterThanOrEqual(0)
    expect(rates.MA30).toBe(1)
    expect(rates.MA90).toBe(2)
    expect(rates.MA_BLEND).toBeCloseTo(1.4, 10)
    expect(rates.CROSTON).toBeCloseTo((1 + 3 * 0.9 ** 60) * 0.95, 10)
  })
})
