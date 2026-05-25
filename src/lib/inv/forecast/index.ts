// 발주 예측 엔진 진입점
//
// forecastOption: 일별 출고 이력을 받아 수요 프로파일 분류 후 적절한 모델로 라우팅.
// buildDailySeries: InvMovement 집계 결과를 연속 날짜 배열(zero-fill)로 변환.

import type { DailyOutbound, ForecastOptions, ForecastResult } from './types'
import { classify } from './classifier'
import { forecastHoltWinters } from './holt-winters'
import { forecastCroston } from './croston'
import { forecastBayesian } from './bayesian'
import { forecastSeasonalNaive } from './seasonal-naive'

export type { DailyOutbound, ForecastOptions, ForecastResult } from './types'
export { computeBiasAdjust } from './bias-adjust'

// ─── zero-fill 헬퍼 ────────────────────────────────────────────────────────────

/**
 * 날짜별 출고 맵(sparse)을 연속된 daily 배열(zero-fill)로 변환.
 *
 * @param outboundByDate - { 'YYYY-MM-DD': qty } 맵 (InvMovement groupBy 결과 변환값)
 * @param windowDays     - 분석 기간 (일). endDate 기준 windowDays일 이전부터 포함.
 * @param endDate        - 기준 날짜 (기본값: 오늘). 해당 날짜는 포함하지 않음(<=endDate-1).
 */
export function buildDailySeries(
  outboundByDate: Record<string, number>,
  windowDays: number,
  endDate: Date = new Date()
): DailyOutbound[] {
  const result: DailyOutbound[] = []
  // endDate 자정 기준으로 windowDays일 소급
  const end = new Date(endDate)
  end.setHours(0, 0, 0, 0)

  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(d.getDate() - i)
    const key = toDateStr(d)
    result.push({ date: key, qty: outboundByDate[key] ?? 0 })
  }

  return result
}

// YYYY-MM-DD 형식 변환
function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ─── 메인 예측 함수 ────────────────────────────────────────────────────────────

/**
 * 옵션별 일별 출고 이력을 기반으로 예측 일평균 소진량을 반환.
 *
 * 주의: history는 반드시 buildDailySeries()로 zero-fill된 연속 배열이어야 한다.
 * sparse 배열을 직접 전달하면 ADI/CV² 계산이 왜곡된다.
 *
 * 라우팅 로직:
 *   - COLD_START → Bayesian Poisson-Gamma (weak prior, 또는 주입된 prior)
 *   - INTERMITTENT → Croston + SBA
 *   - FAST → Holt-Winters (seasonal m=7)
 *
 * seasonalNaiveBlend > 0 이면 HW 결과와 seasonal-naive를 블렌딩.
 */
export function forecastOption(params: {
  history: DailyOutbound[]
  leadTimeDays: number
  options?: ForecastOptions
}): ForecastResult {
  const { history, options = {} } = params
  const { prior, seasonalNaiveBlend = 0 } = options

  const classification = classify(history)

  let result: ForecastResult

  switch (classification.profile) {
    case 'COLD_START':
      result = forecastBayesian(history, prior)
      break

    case 'INTERMITTENT':
      result = forecastCroston(history)
      break

    case 'FAST': {
      const hwResult = forecastHoltWinters(history)
      if (seasonalNaiveBlend > 0 && seasonalNaiveBlend < 1) {
        const naiveResult = forecastSeasonalNaive(history)
        const blended =
          hwResult.dailyAvg * (1 - seasonalNaiveBlend) + naiveResult.dailyAvg * seasonalNaiveBlend
        result = {
          ...hwResult,
          dailyAvg: Math.max(0, blended),
          debug: {
            ...hwResult.debug,
            blend: seasonalNaiveBlend,
            hwDailyAvg: hwResult.dailyAvg,
            naiveDailyAvg: naiveResult.dailyAvg,
          },
        }
      } else {
        result = hwResult
      }
      break
    }
  }

  return {
    ...result,
    debug: {
      ...result.debug,
      profile: classification.profile,
      adi: classification.adi,
      cv2: classification.cv2,
      nonZeroDays: classification.nonZeroDays,
      historyLength: history.length,
    },
  }
}
