/** 쿠팡 price 는 최소 10원 단위. 판매가는 반올림한다. */
export function roundPriceTo10(v: number): number {
  return Math.round(v / 10) * 10
}

/**
 * 자동조정 하한은 **올림**한다. 내림하면 쿠팡이 최소마진 밑으로 팔 수 있다.
 */
export function ceilMinPriceTo10(v: number): number {
  return Math.ceil(v / 10) * 10
}

/** 쿠팡 규칙 apMinSalePrice < price 위반 사유 — 반영 팝업이 상단 안내로 따로 설명한다. */
export const FLOOR_RULE_REASON = '자동조정 최저가가 판매가보다 낮아야 합니다'

export type PriceGuardResult = { ok: true } | { ok: false; reason: string }

export function checkPriceGuards(args: {
  price: number
  apMinSalePrice: number
  includeVat: boolean
}): PriceGuardResult {
  // 시뮬 salePrice 는 includeVat=true 일 때만 VAT 포함 실결제가다.
  // false 면 ex-VAT 라 그대로 밀면 10% 낮게 반영된다. 자동 gross-up 은 하지 않는다.
  if (!args.includeVat) {
    return {
      ok: false,
      reason: 'VAT 미포함 시나리오입니다. 쿠팡 판매가는 VAT 포함 금액이라 반영할 수 없습니다',
    }
  }
  if (!(args.apMinSalePrice < args.price)) {
    return {
      ok: false,
      reason: FLOOR_RULE_REASON,
    }
  }
  return { ok: true }
}
