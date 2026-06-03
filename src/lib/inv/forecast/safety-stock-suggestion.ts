// 안전재고 수정 제안 — 확정 계획들의 예측오차 분산 기반.
//
// 원리: 안전재고는 리드타임 수요의 불확실성 버퍼. ACTIVE accuracy 각 row는
// 리드타임 단위 예측오차(actualOutbound − forecastOutbound) 1개 관측치이므로,
// 그 표준편차 σ에 서비스레벨 z를 곱한 값이 안전재고 권장치.
//   SS = ceil(z × σ)
// row error가 이미 리드타임 scale이므로 ×leadTime / ×√leadTime 재적용하지 않는다.
//
// bias(평균 방향오차)는 예측 보정(computeBiasAdjust)에 쓰고, 여기선 분산만 사용 — 역할 분리.
// 자동 적용하지 않는다(품절/프로모션/판매중단을 안전재고로 오인 방지). 사람 승인 전용.

import { prisma } from '@/lib/prisma'

// 서비스레벨 → z (정규분포 단측). 기본 95%.
export const SERVICE_LEVEL_Z: Record<string, number> = {
  '0.90': 1.2816,
  '0.95': 1.6449,
  '0.975': 1.96,
  '0.99': 2.3263,
}
const DEFAULT_Z = SERVICE_LEVEL_Z['0.95']

// 옵션당 최소 표본 — 표준편차가 의미를 가지려면 최소 2.
const MIN_SAMPLE = 2

export type SafetyStockSuggestion = {
  optionId: string
  sampleCount: number // ACTIVE accuracy row 수
  currentSafetyStock: number // 현재 옵션 안전재고
  suggestedSafetyStock: number | null // 권장값 (표본 부족이면 null)
  dispersion: number | null // 예측오차 표준편차 σ
  insufficient: boolean // 표본 부족 여부 (sampleCount < MIN_SAMPLE)
}

// 표본 표준편차 (n-1). n<2면 null.
function sampleStdev(xs: number[]): number | null {
  const n = xs.length
  if (n < 2) return null
  const mean = xs.reduce((s, x) => s + x, 0) / n
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)
  return Math.sqrt(variance)
}

/**
 * space 내 옵션별 안전재고 제안 산출.
 * @param optionIds 대상 옵션 (생략 시 ACTIVE accuracy가 있는 전체 옵션)
 * @param serviceLevel z 매핑 키 (기본 0.95)
 */
export async function computeSafetyStockSuggestions(
  spaceId: string,
  opts: { optionIds?: string[]; serviceLevel?: keyof typeof SERVICE_LEVEL_Z } = {}
): Promise<SafetyStockSuggestion[]> {
  const z = (opts.serviceLevel && SERVICE_LEVEL_Z[opts.serviceLevel]) || DEFAULT_Z

  // ACTIVE accuracy 로드 — 옵션별 예측오차 관측치
  const rows = await prisma.reorderPlanAccuracy.findMany({
    where: {
      validity: 'ACTIVE',
      plan: { spaceId },
      ...(opts.optionIds ? { optionId: { in: opts.optionIds } } : {}),
    },
    select: { optionId: true, actualOutbound: true, forecastOutbound: true },
  })

  // 옵션별 error 그룹핑 (error = actual − forecast, 리드타임 단위)
  const errorsByOption = new Map<string, number[]>()
  for (const r of rows) {
    const error = r.actualOutbound - Number(r.forecastOutbound)
    const list = errorsByOption.get(r.optionId) ?? []
    list.push(error)
    errorsByOption.set(r.optionId, list)
  }

  const optionIds = Array.from(errorsByOption.keys())
  if (optionIds.length === 0) return []

  // 현재 안전재고 로드
  const options = await prisma.invProductOption.findMany({
    where: { id: { in: optionIds }, product: { spaceId } },
    select: { id: true, safetyStockQty: true },
  })
  const currentByOption = new Map(options.map((o) => [o.id, o.safetyStockQty]))

  const suggestions: SafetyStockSuggestion[] = []
  for (const [optionId, errors] of errorsByOption.entries()) {
    const sampleCount = errors.length
    const dispersion = sampleStdev(errors)
    const insufficient = sampleCount < MIN_SAMPLE || dispersion === null
    suggestions.push({
      optionId,
      sampleCount,
      currentSafetyStock: currentByOption.get(optionId) ?? 0,
      suggestedSafetyStock: insufficient ? null : Math.ceil(z * (dispersion as number)),
      dispersion,
      insufficient,
    })
  }

  return suggestions
}
