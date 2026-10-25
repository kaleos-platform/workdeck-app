import fixtures from './fixtures/product-orders.json'
import type { NaverProductOrder } from '../client'
import { EXCLUDED_STATUSES, isNbaesong, kstDay, nbaesongItemName } from '../nbaesong'

/* eslint-disable @typescript-eslint/no-explicit-any */
// 워커의 toProductOrder 와 같은 매핑(테스트용 축약)
type Raw = { content: { order: Record<string, any>; productOrder: Record<string, any> } }
const toProductOrder = (raw: unknown): NaverProductOrder => {
  const { order: o, productOrder: p } = (raw as Raw).content
  return {
    orderId: o.orderId,
    productOrderId: p.productOrderId,
    paymentDate: o.paymentDate,
    productName: p.productName ?? '',
    quantity: p.quantity ?? 0,
    remainQuantity: p.remainQuantity ?? 0,
    totalPaymentAmount: p.totalPaymentAmount ?? 0,
    remainPaymentAmount: p.remainPaymentAmount ?? 0,
    productOrderStatus: p.productOrderStatus ?? '',
    claimType: p.claimType ?? null,
    deliveryAttributeType: p.deliveryAttributeType ?? null,
    logisticsCompanyId: p.logisticsCompanyId ?? null,
    skuMappings: (p.skuMappings ?? []).map((s: Record<string, any>) => ({
      nsBarcode: s.nsBarcode ?? '',
      pickingQuantityPerOrder: s.pickingQuantityPerOrder ?? 0,
    })),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('isNbaesong', () => {
  it('aml 전부 true', () =>
    fixtures.aml.forEach((r) => expect(isNbaesong(toProductOrder(r))).toBe(true)))
  it('일반배송 전부 false', () =>
    fixtures.kreamdNormal.forEach((r) => expect(isNbaesong(toProductOrder(r))).toBe(false)))
  it('ARRIVAL_GUARANTEE + logisticsCompanyId null → false', () => {
    const po = { ...toProductOrder(fixtures.aml[0]), logisticsCompanyId: null }
    expect(isNbaesong(po)).toBe(false)
  })
})

describe('kstDay', () => {
  it('KST 일자', () => {
    expect(kstDay('2026-10-24T23:59:00+09:00')).toBe('2026-10-24')
    expect(kstDay('2026-10-25T00:00:30+09:00')).toBe('2026-10-25')
    expect(kstDay('2026-10-24T15:00:30Z')).toBe('2026-10-25')
  })
})

it('nbaesongItemName = productName', () => {
  const po = toProductOrder(fixtures.aml[0])
  expect(nbaesongItemName(po)).toBe(po.productName)
})

it('취소 상태는 제외 대상', () => {
  expect(EXCLUDED_STATUSES.has(toProductOrder(fixtures.amlCancel[0]).productOrderStatus)).toBe(true)
})
