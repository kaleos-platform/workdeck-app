// 상품 옵션 목록 → 대표 가격그룹 해석 (시뮬레이터 상품 자동 선택용)

import { groupOptionsByPrice, type OptionInput } from './price-group'

export type ResolvedPriceGroup = {
  optionId: string // 대표 옵션
  optionIds: string[] // 그룹 전체 옵션
  costPrice: number
  retailPrice: number
}

/**
 * 옵션 목록에서 대표 가격그룹을 골라 시뮬 행 값으로 변환한다.
 * 정책: 가격이 정의된(!priceUndefined) 첫 그룹 → 없으면 첫 그룹(원가/소매가 0 폴백).
 * 옵션이 없으면 null.
 */
export function resolveFirstPriceGroup(options: OptionInput[]): ResolvedPriceGroup | null {
  const groups = groupOptionsByPrice(options)
  if (groups.length === 0) return null
  const chosen = groups.find((g) => !g.priceUndefined) ?? groups[0]
  return {
    optionId: chosen.representativeOptionId,
    optionIds: chosen.optionIds,
    costPrice: chosen.costPrice ?? 0,
    retailPrice: chosen.retailPrice ?? 0,
  }
}
