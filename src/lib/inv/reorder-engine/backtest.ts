// 상품 단위 백테스트 + 모델 추천 (순수 함수)

import { forecastRates, type ModelKey } from './models'
import type { DayPoint } from './series'

const MODEL_ORDER: ModelKey[] = ['MA_BLEND', 'MA30', 'MA90', 'SES_TREND', 'CROSTON']
const MIN_TRAIN_DAYS = 30

type Scores = Record<ModelKey, number | null>

const nullScores = (): Scores => ({
  MA30: null,
  MA90: null,
  MA_BLEND: null,
  SES_TREND: null,
  CROSTON: null,
})

/**
 * 각 옵션 시계열 끝 horizonDays 일을 holdout 으로 두고 앞부분으로 예측 → 예측합 vs 실제합.
 * 품절일은 실제·예측 양쪽에서 제외. 상품 WAPE = Σ|예측−실제| ÷ Σ실제 (Σ실제 0 이면 null).
 * 학습 구간 30일 미만 옵션은 제외 (사용 가능 옵션 없으면 전 모델 null).
 */
export function backtestProduct(optionSeries: DayPoint[][], horizonDays: number): Scores {
  const h = Math.max(1, Math.floor(horizonDays))
  const absErr: Record<ModelKey, number> = {
    MA30: 0,
    MA90: 0,
    MA_BLEND: 0,
    SES_TREND: 0,
    CROSTON: 0,
  }
  let actualSum = 0
  for (const series of optionSeries) {
    const train = series.slice(0, Math.max(0, series.length - h))
    if (train.length < MIN_TRAIN_DAYS) continue
    const holdout = series.slice(-h).filter((p) => !p.stockout)
    const actual = holdout.reduce((s, p) => s + p.qty, 0)
    const rates = forecastRates(train, h)
    actualSum += actual
    for (const k of MODEL_ORDER) absErr[k] += Math.abs(rates[k] * holdout.length - actual)
  }
  if (actualSum <= 0) return nullScores()
  const out = nullScores()
  for (const k of MODEL_ORDER) out[k] = absErr[k] / actualSum
  return out
}

/** 점수 = 백테스트와 실적(있으면) 평균, 최소 점수 모델. 전부 null 이면 MA_BLEND. 'USER' 실적은 선택에서 무시. */
export function recommendModel(
  backtest: Scores,
  realized: Partial<Record<ModelKey | 'USER', number>> = {}
): { model: ModelKey; scores: Scores } {
  const scores = nullScores()
  let best: ModelKey | null = null
  for (const k of MODEL_ORDER) {
    const parts = [backtest[k], realized[k]].filter((v): v is number => v != null)
    if (parts.length === 0) continue
    scores[k] = parts.reduce((s, v) => s + v, 0) / parts.length
    if (best === null || scores[k]! < scores[best]!) best = k
  }
  return { model: best ?? 'MA_BLEND', scores }
}
