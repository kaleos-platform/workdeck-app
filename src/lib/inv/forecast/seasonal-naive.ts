// Seasonal Naive (요일별 평균) — 블렌딩용 베이스라인
//
// 각 요일(0=일~6=토)의 평균 출고량을 계산해 7일 주기 예측.
// dailyAvg = 7개 요일 평균의 산술 평균.

import type { DailyOutbound, ForecastResult } from './types'

const DAYS_IN_WEEK = 7

export function forecastSeasonalNaive(history: DailyOutbound[]): ForecastResult {
  const n = history.length

  if (n === 0) {
    return {
      dailyAvg: 0,
      model: 'SMA', // 베이스라인은 별도 enum 없음 → SMA로 매핑
      confidence: 0.1,
      debug: { message: '데이터 없음' },
    }
  }

  // 요일별 수량 집계
  const dowSums = new Array<number>(DAYS_IN_WEEK).fill(0)
  const dowCounts = new Array<number>(DAYS_IN_WEEK).fill(0)

  for (const entry of history) {
    const dow = new Date(entry.date).getDay() // 0=일, 6=토
    dowSums[dow] += entry.qty
    dowCounts[dow]++
  }

  const dowAvgs = dowSums.map((sum, i) => (dowCounts[i] > 0 ? sum / dowCounts[i] : 0))

  const dailyAvg = dowAvgs.reduce((s, v) => s + v, 0) / DAYS_IN_WEEK

  const confidence = Math.min(0.6, Math.max(0.2, n / 90))

  return {
    dailyAvg: Math.max(0, dailyAvg),
    model: 'SMA',
    confidence,
    debug: { dowAvgs: dowAvgs.map(round4), n },
  }
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}
