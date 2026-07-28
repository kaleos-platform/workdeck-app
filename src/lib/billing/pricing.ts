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

function ymd(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
}

// 정기결제 멱등 orderId: 구독 × 주기 시작시각 1건 보장.
// periodStart는 DB의 currentPeriodEnd 그대로라 cron 재실행 시 동일 → 중복 결제 차단,
// 주기가 바뀌면 시각이 달라져 새 청구 허용. (월 단위 ym 키는 같은 달 재시작과 충돌해 폐기)
export function cycleOrderId(subscriptionId: string, periodStart: Date): string {
  const hms = `${String(periodStart.getUTCHours()).padStart(2, '0')}${String(periodStart.getUTCMinutes()).padStart(2, '0')}${String(periodStart.getUTCSeconds()).padStart(2, '0')}`
  return `sub_${subscriptionId}_${ymd(periodStart)}${hms}`
}

// 구독 시작 멱등 orderId: 구독 × 일 단위 1건 보장 (같은 날 중복 시작 클릭 차단)
export function startOrderId(subscriptionId: string, date: Date): string {
  return `substart_${subscriptionId}_${ymd(date)}`
}

// 일할 즉시결제 멱등 orderId: 아이템×일 단위 1건 보장
// (같은 날 중복 추가 시도는 멱등 차단, 해제 후 재추가는 다른 날이면 새 청구 허용)
export function prorateOrderId(itemId: string, date: Date): string {
  return `prorate_${itemId}_${ymd(date)}`
}
