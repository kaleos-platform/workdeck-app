// 공급원가 VAT 처리 유틸 — 서버/클라이언트 공용(순수 함수).
// 공급원가는 ex-VAT(VAT 제외) 기준으로 관리한다. 입력값에 VAT가 포함된 경우 ÷(1+율)로 제거.

/** 공급원가 매입 VAT 율 (한국 표준 10%). sim globals.vatRate와는 별개 컨텍스트. */
export const SUPPLY_VAT_RATE = 0.1

/**
 * 공급원가를 VAT 제외(ex-VAT) 금액으로 환산.
 * @param amount 입력 금액(raw)
 * @param vatIncluded true면 amount에 VAT 포함 → ÷(1+율), false면 이미 ex-VAT → 그대로
 */
export function costExVat(amount: number | null | undefined, vatIncluded: boolean): number {
  const v = Number(amount) || 0
  return vatIncluded ? v / (1 + SUPPLY_VAT_RATE) : v
}

/** 원 단위 표시에서 구성 항목의 합이 표시 총액과 일치하도록 반올림 오차를 보정한다. */
export function formatCostBreakdown(
  productionUnitCost: number,
  marketingUnitCost: number,
  totalUnitCost: number
): string {
  const production = Math.round(productionUnitCost)
  const marketing = Math.round(marketingUnitCost)
  const total = Math.round(totalUnitCost)
  // 각 항을 따로 반올림할 때 생기는 잔여 원은 마케팅 항목에 반영한다.
  const roundingDelta = total - production - marketing
  const adjustedMarketing = marketing + roundingDelta
  const won = (value: number) => `${value.toLocaleString('ko-KR')}원`

  return `생산원가 ${won(production)} + 초기 마케팅비 ${won(adjustedMarketing)} = 공급원가 ${won(total)}`
}
