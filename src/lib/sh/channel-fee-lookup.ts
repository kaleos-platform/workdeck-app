// 채널 카테고리별 수수료 조회 및 정규화 헬퍼
//
// 모든 채널은 '기본' 카테고리 ChannelFeeRate를 항상 1건 보유한다.
// 가격 계산 시 item의 카테고리에 일치하는 ChannelFeeRate가 있으면 그 ratePercent,
// 없으면 '기본' fallback. lookup 결과는 0~1 비율로 반환한다.

export const DEFAULT_FEE_CATEGORY = '기본'

export type FeeRateInput = {
  categoryName: string
  ratePercent: number
}

// 클라이언트가 보낸 feeRates를 정규화한다
// - 비어있거나 undefined면 '기본' 0% 1건 자동 추가
// - '기본' 카테고리가 없으면 0% 자동 추가
// - 동일 카테고리 중복은 마지막 항목 기준
// - 빈 카테고리명은 제거
export function normalizeFeeRates(input: FeeRateInput[] | undefined | null): FeeRateInput[] {
  const map = new Map<string, FeeRateInput>()
  for (const fr of input ?? []) {
    const name = fr.categoryName.trim()
    if (!name) continue
    map.set(name, { categoryName: name, ratePercent: Number(fr.ratePercent) || 0 })
  }
  if (!map.has(DEFAULT_FEE_CATEGORY)) {
    map.set(DEFAULT_FEE_CATEGORY, { categoryName: DEFAULT_FEE_CATEGORY, ratePercent: 0 })
  }
  return Array.from(map.values())
}

// item의 categoryName으로 적용 수수료율(0~1)을 찾는다
export function lookupCategoryFeePct(
  feeRates: FeeRateInput[],
  categoryName?: string | null
): number {
  if (categoryName) {
    const exact = feeRates.find((f) => f.categoryName === categoryName)
    if (exact) return Number(exact.ratePercent) / 100
  }
  const fallback = feeRates.find((f) => f.categoryName === DEFAULT_FEE_CATEGORY)
  return fallback ? Number(fallback.ratePercent) / 100 : 0
}
