// 요금 계산 순수 함수 — VAT 별도(공급가 저장, 결제액 = 공급가 × 1.1), 일할계산.
export const VAT_RATE = 0.1

export interface ChargeLine {
  deckAppId: string
  type: 'DECK' | 'ADDON'
  price: number // 공급가
}

export interface ChargeAmounts {
  supplyAmount: number
  vatAmount: number
  amount: number // VAT 포함 최종 결제액
}

// 공급가 합계 → VAT·최종액. 원 단위 절사 없이 반올림(국세청 관행: VAT 원미만 절사도 허용되나 반올림 통일).
export function calcAmounts(supplyAmount: number): ChargeAmounts {
  const vatAmount = Math.round(supplyAmount * VAT_RATE)
  return { supplyAmount, vatAmount, amount: supplyAmount + vatAmount }
}

export function sumLines(lines: ChargeLine[]): ChargeAmounts {
  return calcAmounts(lines.reduce((acc, l) => acc + l.price, 0))
}

// 일할계산: (남은 일수 ÷ 주기 일수) × 월가. 공급가 기준 반올림 후 VAT 적용.
// remainingDays는 최소 1일 보장(당일 추가도 1일 청구), cycleDays 이상이면 전액.
export function prorate(monthlyPrice: number, remainingDays: number, cycleDays: number): number {
  if (cycleDays <= 0) return 0
  const days = Math.min(Math.max(remainingDays, 1), cycleDays)
  return Math.round((monthlyPrice * days) / cycleDays)
}

// 두 시각 사이 남은 일수 (올림 — 부분일도 1일로 청구)
export function remainingDaysBetween(now: Date, periodEnd: Date): number {
  const ms = periodEnd.getTime() - now.getTime()
  if (ms <= 0) return 0
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}

// 정기결제 멱등 orderId: Space 구독 × 청구월 1건 보장
export function cycleOrderId(subscriptionId: string, periodStart: Date): string {
  const ym = `${periodStart.getUTCFullYear()}${String(periodStart.getUTCMonth() + 1).padStart(2, '0')}`
  return `sub_${subscriptionId}_${ym}`
}

// 일할 즉시결제 멱등 orderId: 아이템당 1건 보장
export function prorateOrderId(itemId: string): string {
  return `prorate_${itemId}`
}
