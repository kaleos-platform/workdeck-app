// Croston 방법 + SBA (Syntetos-Boylan Approximation) debias
//
// 간헐적 수요(Intermittent demand)에 사용.
// α=0.1, SBA debias 계수: × (1 - α/2)
//
// 알고리즘:
//   수요 발생 시점마다 수요량(z)과 간격(p)을 지수평활.
//   예측 = (z_hat / p_hat) × (1 - α/2)

import type { DailyOutbound, ForecastResult } from './types'

const ALPHA = 0.1
const SBA_DEBIAS = 1 - ALPHA / 2 // 0.95

export function forecastCroston(history: DailyOutbound[]): ForecastResult {
  const qty = history.map((d) => d.qty)
  const n = qty.length

  // 비-zero 인덱스 수집
  const nonZeroIndices: number[] = []
  for (let i = 0; i < n; i++) {
    if (qty[i] > 0) nonZeroIndices.push(i)
  }

  if (nonZeroIndices.length === 0) {
    return {
      dailyAvg: 0,
      model: 'CROSTON',
      confidence: 0.2,
      debug: { nonZeroDays: 0, message: '비-zero 수요 없음' },
    }
  }

  if (nonZeroIndices.length === 1) {
    // 단 1회 수요 → 전체 기간 평균으로 폴백
    const avg = qty[nonZeroIndices[0]] / n
    return {
      dailyAvg: avg,
      model: 'CROSTON',
      confidence: 0.3,
      debug: { nonZeroDays: 1, fallback: 'single_obs' },
    }
  }

  // ── Croston 평활 ─────────────────────────────────────────────────────────────

  // 초기값: 첫 번째 비-zero 수요량과 간격
  let zHat = qty[nonZeroIndices[0]] // 수요량 평활값
  let pHat = nonZeroIndices[0] + 1 // 간격 평활값 (첫 번째 이벤트까지의 간격)

  let prevNonZeroIdx = nonZeroIndices[0]

  for (let k = 1; k < nonZeroIndices.length; k++) {
    const idx = nonZeroIndices[k]
    const interval = idx - prevNonZeroIdx

    zHat = ALPHA * qty[idx] + (1 - ALPHA) * zHat
    pHat = ALPHA * interval + (1 - ALPHA) * pHat

    prevNonZeroIdx = idx
  }

  // SBA debias 적용
  const rawRate = pHat > 0 ? zHat / pHat : 0
  const dailyAvg = Math.max(0, rawRate * SBA_DEBIAS)

  // 신뢰도: 수요 빈도 기반 (비-zero 비율이 높을수록 Croston의 적합성이 낮아짐)
  // ADI가 1.32~3 범위일 때 가장 신뢰도 높음 → 빈도에 따라 0.4~0.75
  const adi = n / nonZeroIndices.length
  const confidence = Math.min(0.75, Math.max(0.4, 1 - Math.abs(adi - 2) / 10))

  return {
    dailyAvg,
    model: 'CROSTON',
    confidence,
    debug: {
      alpha: ALPHA,
      sbDebias: SBA_DEBIAS,
      zHat: round4(zHat),
      pHat: round4(pHat),
      adi: round4(adi),
      nonZeroDays: nonZeroIndices.length,
    },
  }
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}
