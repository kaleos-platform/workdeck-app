import { NaverProductOrderSchema } from '../client'

const valid = {
  orderId: 'o1',
  productOrderId: 'po1',
  paymentDate: '2026-10-22T01:00:00.000Z',
  productName: 'x',
  quantity: 1,
  remainQuantity: 1,
  totalPaymentAmount: 1000,
  remainPaymentAmount: 1000,
  productOrderStatus: 'PAYED',
  claimType: null,
  deliveryAttributeType: 'ARRIVAL_GUARANTEE',
  logisticsCompanyId: 'NSLOGI',
  skuMappings: [{ nsBarcode: 'b', pickingQuantityPerOrder: 1 }],
}

describe('NaverProductOrderSchema', () => {
  it('유효한 주문 통과', () => expect(NaverProductOrderSchema.safeParse(valid).success).toBe(true))
  it('필드 타입 오류 거부', () =>
    expect(NaverProductOrderSchema.safeParse({ ...valid, quantity: '1' }).success).toBe(false))
})
