// 발주 예측 엔진 단위 테스트
// 고정 fixture 기반 — 외부 의존성 없음

import { classify } from '../classifier'
import { forecastHoltWinters } from '../holt-winters'
import { forecastCroston } from '../croston'
import { forecastBayesian } from '../bayesian'
import { computeBiasAdjust } from '../bias-adjust'
import { buildDailySeries, forecastOption } from '../index'
import type { DailyOutbound } from '../types'

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

/** N일치 고정값 배열 생성 */
function makeHistory(n: number, qty: number): DailyOutbound[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date('2024-01-01')
    d.setDate(d.getDate() + i)
    return { date: d.toISOString().slice(0, 10), qty }
  })
}

/** 간헐적 수요 패턴 생성 (every-k-days 에만 고정 qty 발생) — Croston 수치 검증용 */
function makeIntermittent(n: number, everyK: number, qty: number): DailyOutbound[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date('2024-01-01')
    d.setDate(d.getDate() + i)
    return { date: d.toISOString().slice(0, 10), qty: i % everyK === 0 ? qty : 0 }
  })
}

/**
 * INTERMITTENT 분류 테스트 전용 픽스처 (ADI>1.32 && CV²>0.49 충족)
 *
 * qty를 고정값으로 주면 CV²=0 → FAST로 분류된다.
 * 발생 시 qty를 [10, 50, 100] 사이클로 변동시켜 CV²≈1.1 을 확보한다.
 */
function makeIntermittentVariable(n: number, everyK: number): DailyOutbound[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date('2024-01-01')
    d.setDate(d.getDate() + i)
    if (i % everyK !== 0) return { date: d.toISOString().slice(0, 10), qty: 0 }
    const cycleIdx = Math.floor(i / everyK) % 3
    // [5, 50, 100] 사이클 → CV²≈0.56 (> 0.49 임계값 충족)
    const qty = cycleIdx === 0 ? 5 : cycleIdx === 1 ? 50 : 100
    return { date: d.toISOString().slice(0, 10), qty }
  })
}

// ── classifier ─────────────────────────────────────────────────────────────────

describe('classifier', () => {
  it('이력 13일이면 COLD_START', () => {
    const h = makeHistory(13, 5)
    const r = classify(h)
    expect(r.profile).toBe('COLD_START')
  })

  it('이력 0이면 COLD_START', () => {
    const h = makeHistory(30, 0)
    const r = classify(h)
    expect(r.profile).toBe('COLD_START')
  })

  it('안정적인 일별 수요 → FAST', () => {
    const h = makeHistory(90, 10)
    const r = classify(h)
    expect(r.profile).toBe('FAST')
    expect(r.adi).toBeCloseTo(1.0, 1)
  })

  it('ADI>1.32 && CV²>0.49 → INTERMITTENT', () => {
    // 3일마다 발생 → ADI≈3, qty 변동(10/50/100) → CV²≈1.1 → INTERMITTENT
    const h = makeIntermittentVariable(90, 3)
    const r = classify(h)
    expect(r.profile).toBe('INTERMITTENT')
    expect(r.adi).toBeGreaterThan(1.32)
  })
})

// ── Holt-Winters ───────────────────────────────────────────────────────────────

describe('forecastHoltWinters', () => {
  it('고정값 이력 → dailyAvg ≈ 고정값', () => {
    const h = makeHistory(60, 10)
    const r = forecastHoltWinters(h)
    expect(r.model).toBe('HW')
    expect(r.dailyAvg).toBeGreaterThan(8)
    expect(r.dailyAvg).toBeLessThan(12)
  })

  it('데이터 14일 미만 → dailyAvg는 단순 평균', () => {
    const h = makeHistory(10, 5)
    const r = forecastHoltWinters(h)
    expect(r.dailyAvg).toBeCloseTo(5, 0)
  })

  it('confidence가 0~1 범위', () => {
    const h = makeHistory(90, 10)
    const r = forecastHoltWinters(h)
    expect(r.confidence).toBeGreaterThanOrEqual(0)
    expect(r.confidence).toBeLessThanOrEqual(1)
  })
})

// ── Croston ───────────────────────────────────────────────────────────────────

describe('forecastCroston', () => {
  it('3일 간격 발생 → dailyAvg ≈ qty/3', () => {
    const h = makeIntermittent(90, 3, 30)
    const r = forecastCroston(h)
    expect(r.model).toBe('CROSTON')
    // SBA debias 적용 후 ≈ 9.5 (10 × 0.95)
    expect(r.dailyAvg).toBeGreaterThan(7)
    expect(r.dailyAvg).toBeLessThan(13)
  })

  it('모두 0이면 dailyAvg=0', () => {
    const h = makeHistory(30, 0)
    const r = forecastCroston(h)
    expect(r.dailyAvg).toBe(0)
  })
})

// ── Bayesian ──────────────────────────────────────────────────────────────────

describe('forecastBayesian', () => {
  it('데이터 없이 weak prior → dailyAvg=1/(1+1)=0.5', () => {
    const h: DailyOutbound[] = []
    const r = forecastBayesian(h)
    expect(r.model).toBe('BAYES')
    expect(r.dailyAvg).toBeCloseTo(1 / 1, 2) // α₀/β₀ = 1/1
  })

  it('강한 prior + 많은 데이터 → prior 영향 감소', () => {
    const h = makeHistory(30, 5) // 총 150, N=30
    const r = forecastBayesian(h, { alpha0: 10, beta0: 2 })
    // (10+150)/(2+30) = 160/32 = 5.0
    expect(r.dailyAvg).toBeCloseTo(5.0, 1)
  })
})

// ── biasAdjust ────────────────────────────────────────────────────────────────

describe('computeBiasAdjust', () => {
  it('null → 1.0', () => {
    expect(computeBiasAdjust(null)).toBe(1.0)
  })

  it('bias=0 → 1.0', () => {
    expect(computeBiasAdjust(0)).toBeCloseTo(1.0, 5)
  })

  it('과예측(bias=0.20) → 0.833', () => {
    expect(computeBiasAdjust(0.2)).toBeCloseTo(1 / 1.2, 3)
  })

  it('과소예측(bias=-0.15) → clamp 전 1.176', () => {
    expect(computeBiasAdjust(-0.15)).toBeCloseTo(1 / 0.85, 3)
  })

  it('극단적 과예측은 0.7 이상으로 클램핑', () => {
    // bias=0.99 → 1/1.99 ≈ 0.503 → clamp → 0.7
    expect(computeBiasAdjust(0.99)).toBe(0.7)
  })

  it('극단적 과소예측은 1.3 이하로 클램핑', () => {
    // bias=-0.50 → 1/0.5 = 2.0 → clamp → 1.3
    expect(computeBiasAdjust(-0.5)).toBe(1.3)
  })
})

// ── buildDailySeries ──────────────────────────────────────────────────────────

describe('buildDailySeries', () => {
  it('windowDays=7, sparse 맵 → 7개 배열 반환', () => {
    const endDate = new Date('2024-03-10')
    const map: Record<string, number> = {
      '2024-03-08': 5,
      '2024-03-09': 10,
    }
    const series = buildDailySeries(map, 7, endDate)
    expect(series).toHaveLength(7)
    // 2024-03-08 값 확인
    const mar08 = series.find((d) => d.date === '2024-03-08')
    expect(mar08?.qty).toBe(5)
    // 비어있는 날은 0
    const mar05 = series.find((d) => d.date === '2024-03-05')
    expect(mar05?.qty).toBe(0)
  })

  it('빈 맵은 모두 0', () => {
    const series = buildDailySeries({}, 14, new Date('2024-01-15'))
    expect(series).toHaveLength(14)
    expect(series.every((d) => d.qty === 0)).toBe(true)
  })
})

// ── forecastOption 라우팅 ─────────────────────────────────────────────────────

describe('forecastOption 라우팅', () => {
  it('COLD_START → BAYES 모델', () => {
    const h = makeHistory(7, 3)
    const r = forecastOption({ history: h, leadTimeDays: 7 })
    expect(r.model).toBe('BAYES')
  })

  it('FAST → HW 모델', () => {
    const h = makeHistory(60, 10)
    const r = forecastOption({ history: h, leadTimeDays: 14 })
    expect(r.model).toBe('HW')
  })

  it('INTERMITTENT → CROSTON 모델', () => {
    const h = makeIntermittentVariable(60, 3)
    const r = forecastOption({ history: h, leadTimeDays: 14 })
    expect(r.model).toBe('CROSTON')
  })

  it('debug에 profile 정보 포함', () => {
    const h = makeHistory(60, 5)
    const r = forecastOption({ history: h, leadTimeDays: 7 })
    expect(r.debug).toHaveProperty('profile')
    expect(r.debug).toHaveProperty('historyLength', 60)
  })
})
