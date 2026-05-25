// Holt-Winters Additive 지수평활법 (주간 계절성 m=7)
//
// 파라미터: α=0.3 (수준), β=0.1 (추세), γ=0.1 (계절성)
// 신뢰도: 잔차 MAPE 역수 기반

import type { DailyOutbound, ForecastResult } from './types'

const ALPHA = 0.3
const BETA = 0.1
const GAMMA = 0.1
const SEASON_LENGTH = 7 // 주간 계절성

export function forecastHoltWinters(history: DailyOutbound[]): ForecastResult {
  const qty = history.map((d) => d.qty)
  const n = qty.length

  // 계절성 계산에 최소 2시즌(14일) 필요
  if (n < SEASON_LENGTH * 2) {
    // 데이터 부족 — 단순 평균으로 폴백
    const avg = qty.reduce((s, v) => s + v, 0) / n
    return {
      dailyAvg: avg,
      model: 'HW',
      confidence: 0.3,
      debug: { fallback: 'sma', n, avg },
    }
  }

  // ── 초기화 ──────────────────────────────────────────────────────────────────

  // 초기 수준: 첫 시즌 평균
  let level = qty.slice(0, SEASON_LENGTH).reduce((s, v) => s + v, 0) / SEASON_LENGTH

  // 초기 추세: 시즌 간 평균 차이 / SEASON_LENGTH
  const secondSeasonAvg =
    qty.slice(SEASON_LENGTH, SEASON_LENGTH * 2).reduce((s, v) => s + v, 0) / SEASON_LENGTH
  let trend = (secondSeasonAvg - level) / SEASON_LENGTH

  // 초기 계절 인수: 관측값 / 초기수준 (전체 시즌 평균으로 정규화)
  const seasonals: number[] = []
  for (let i = 0; i < SEASON_LENGTH; i++) {
    seasonals.push(qty[i] / (level || 1))
  }

  // ── 평활 루프 ────────────────────────────────────────────────────────────────

  const fittedValues: number[] = []
  const currentSeasonals = [...seasonals]

  for (let t = 0; t < n; t++) {
    const si = t % SEASON_LENGTH
    const prevLevel = level
    const prevTrend = trend

    const fitted = (prevLevel + prevTrend) * (currentSeasonals[si] || 1)
    fittedValues.push(fitted)

    const observed = qty[t]

    // 수준 업데이트
    level = ALPHA * (observed / (currentSeasonals[si] || 1)) + (1 - ALPHA) * (prevLevel + prevTrend)
    // 추세 업데이트
    trend = BETA * (level - prevLevel) + (1 - BETA) * prevTrend
    // 계절 인수 업데이트
    currentSeasonals[si] =
      GAMMA * (observed / (level || 1)) + (1 - GAMMA) * (currentSeasonals[si] || 1)
  }

  // ── 1일 앞 예측 ──────────────────────────────────────────────────────────────
  const nextSi = n % SEASON_LENGTH
  const forecast = (level + trend) * (currentSeasonals[nextSi] || 1)
  const dailyAvg = Math.max(0, forecast)

  // ── 신뢰도: 잔차 MAPE 역수 (0.1~0.9 범위로 클램핑) ──────────────────────────
  const errors = fittedValues.map((f, i) => {
    const actual = qty[i]
    if (actual === 0) return 0
    return Math.abs((f - actual) / actual)
  })
  const mape = errors.reduce((s, e) => s + e, 0) / errors.length
  const confidence = Math.min(0.9, Math.max(0.1, 1 - mape))

  return {
    dailyAvg,
    model: 'HW',
    confidence,
    debug: { alpha: ALPHA, beta: BETA, gamma: GAMMA, level, trend, mape: round4(mape) },
  }
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}
