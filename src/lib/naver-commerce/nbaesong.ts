import type { NaverProductOrder } from './client'

// 집계 제외 상태 (취소·미결제)
export const EXCLUDED_STATUSES: ReadonlySet<string> = new Set([
  'CANCELED',
  'CANCELED_BY_NOPAYMENT',
  'PAYMENT_WAITING',
])

export function isNbaesong(po: NaverProductOrder): boolean {
  return po.deliveryAttributeType === 'ARRIVAL_GUARANTEE' && !!po.logisticsCompanyId
}

// KST 고정(UTC+9, DST 없음)
export function kstDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}

// 옵션 텍스트가 productName 안에 포함되어 있다
export function nbaesongItemName(po: NaverProductOrder): string {
  return po.productName
}
