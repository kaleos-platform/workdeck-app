// 수요 분류기 — ADI / CV² 기반으로 예측 프로파일 결정
//
// 프로파일 기준:
//   - history < 14일 → COLD_START
//   - ADI > 1.32 && CV² > 0.49 → INTERMITTENT (간헐적 수요)
//   - 그 외 → FAST (정규 수요)
//
// ADI (Average Demand Interval): 평균 수요 간격 = 전체 기간 / 비-zero 일수
// CV² (변동계수 제곱): (표준편차 / 평균)² — 비-zero 값 기준

import type { DailyOutbound, ClassifierResult } from './types'

// ADI 임계값 (Syntetos-Boylan 기준)
const ADI_THRESHOLD = 1.32
// CV² 임계값
const CV2_THRESHOLD = 0.49
// 콜드 스타트 최소 이력 일수
const COLD_START_MIN_DAYS = 14

export function classify(history: DailyOutbound[]): ClassifierResult {
  const n = history.length

  // 이력 부족 → 콜드 스타트
  if (n < COLD_START_MIN_DAYS) {
    return { profile: 'COLD_START', adi: 0, cv2: 0, nonZeroDays: 0 }
  }

  const nonZeroValues = history.map((d) => d.qty).filter((q) => q > 0)
  const nonZeroDays = nonZeroValues.length

  // 수요가 전혀 없으면 콜드 스타트로 처리
  if (nonZeroDays === 0) {
    return { profile: 'COLD_START', adi: n, cv2: 0, nonZeroDays: 0 }
  }

  // ADI: 전체 일수 / 비-zero 일수
  const adi = n / nonZeroDays

  // CV²: 비-zero 수요 값의 (표준편차/평균)²
  const mean = nonZeroValues.reduce((sum, v) => sum + v, 0) / nonZeroDays
  const variance = nonZeroValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / nonZeroDays
  const cv2 = mean > 0 ? variance / (mean * mean) : 0

  const profile = adi > ADI_THRESHOLD && cv2 > CV2_THRESHOLD ? 'INTERMITTENT' : 'FAST'

  return { profile, adi, cv2, nonZeroDays }
}
