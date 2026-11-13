// 예측 모델 5종 — 품절일 제외 후 일률(≥0)

import { forecastCroston } from '@/lib/inv/forecast/croston'
import type { DayPoint } from './series'

export type ModelKey = 'MA30' | 'MA90' | 'MA_BLEND' | 'SES_TREND' | 'CROSTON'

const ALPHA = 0.3
const BETA = 0.1

/** 시리즈 마지막 n일 중 비품절일 평균 (유효일 0이면 0) */
function recentAvg(series: DayPoint[], n: number): number {
  const valid = series.slice(-n).filter((p) => !p.stockout)
  return valid.length === 0 ? 0 : valid.reduce((s, p) => s + p.qty, 0) / valid.length
}

/** Holt 선형(계절 없음) — 1..horizon 일 예측 평균 */
function holt(qty: number[], horizonDays: number): number {
  if (qty.length === 0) return 0
  let level = qty[0]
  let trend = qty.length > 1 ? qty[1] - qty[0] : 0
  for (let i = 1; i < qty.length; i++) {
    const prev = level
    level = ALPHA * qty[i] + (1 - ALPHA) * (level + trend)
    trend = BETA * (level - prev) + (1 - BETA) * trend
  }
  const h = Math.max(1, Math.floor(horizonDays))
  let sum = 0
  for (let k = 1; k <= h; k++) sum += Math.max(0, level + k * trend)
  return sum / h
}

export function forecastRates(series: DayPoint[], horizonDays: number): Record<ModelKey, number> {
  const valid = series.filter((p) => !p.stockout)
  if (valid.length === 0) {
    return { MA30: 0, MA90: 0, MA_BLEND: 0, SES_TREND: 0, CROSTON: 0 }
  }
  const ma30 = recentAvg(series, 30)
  const ma90 = recentAvg(series, 90)
  return {
    MA30: ma30,
    MA90: ma90,
    MA_BLEND: 0.6 * ma30 + 0.4 * ma90,
    SES_TREND: holt(
      valid.map((p) => p.qty),
      horizonDays
    ),
    CROSTON: Math.max(
      0,
      forecastCroston(valid.map((p) => ({ date: p.date, qty: p.qty }))).dailyAvg
    ),
  }
}
