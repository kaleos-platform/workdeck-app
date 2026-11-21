import crypto from 'node:crypto'
import type { OrderLineInput } from './types'

/** 변경 감지용 해시 — 시각·가변 필드를 정규화해 같은 내용이면 같은 값. */
export function rawHashOf(l: OrderLineInput): string {
  const t = (v?: string | null) => (v ? new Date(v).toISOString() : '')
  const canon = [
    l.externalOrderId,
    t(l.paidAt),
    l.productName,
    l.optionText ?? '',
    l.quantity,
    l.channelStatus,
    l.claimStatus ?? '',
    l.deliveryKind,
    t(l.shippingDueAt),
    l.carrierCode ?? '',
    l.trackingNumber ?? '',
    t(l.dispatchedAt),
  ].join('\u0001')
  return crypto.createHash('sha256').update(canon).digest('hex')
}

/** 주문번호 비교용 정규화 — 공백·하이픈 제거, 영문 대문자. */
export function normalizeOrderNumber(raw: string): string {
  return raw.replace(/[\s\-_]/g, '').toUpperCase()
}

/** 형식 패턴(원문 비노출): 숫자 연속 → N{자릿수}, 영문 연속 → A{글자수}, 구분자는 그대로. */
export function keyPattern(raw: string): string {
  return raw
    .trim()
    .replace(/\d+|[A-Za-z]+/g, (m) => `${/\d/.test(m) ? 'N' : 'A'}${m.length}`)
    .replace(/[^NA\d\-_.:/ ]/g, '?')
    .slice(0, 40)
}

export const isCancelled = (l: { channelStatus: string; claimStatus?: string | null }) =>
  /CANCEL/i.test(l.channelStatus) || /CANCEL/i.test(l.claimStatus ?? '')
