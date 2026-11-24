// @jest-environment node
// 워커 수집기 출력이 앱 ingest 스키마(strict, productName 필수)를 통과하는지 — 워커는 앱 타입을 import 할 수 없어 여기서 대조한다.
import { parseQueryRows, parseScanPage } from '../../../../worker/src/channel-orders/naver'
import { parseSheet } from '../../../../worker/src/channel-orders/coupang'
import { OrderLineInputSchema, ScanLineInputSchema } from '../types'

const order = { orderId: 'O1', paymentDate: '2026-11-24T09:00:00.000+09:00' }
const po = { productOrderId: 'P1', productName: '상품', quantity: 1, productOrderStatus: 'PAYED' }

describe('워커 출력 ↔ 앱 스키마', () => {
  it('네이버 관측 행(최소·전체 필드)', () => {
    const rows = parseQueryRows(
      {
        data: [
          { order, productOrder: po },
          {
            order,
            productOrder: {
              ...po,
              productOption: 'o',
              claimType: 'CANCEL',
              shippingDueDate: '2026-11-26T00:00:00+09:00',
            },
            delivery: {
              deliveryCompany: 'CJ',
              trackingNumber: '1',
              sendDate: '2026-11-24T10:00:00+09:00',
            },
          },
        ],
      },
      new Map([['P1', '2026-11-24T10:00:00+09:00']])
    )
    for (const r of rows) expect(OrderLineInputSchema.safeParse(r).error).toBeUndefined()
  })
  it('네이버 전수 행', () => {
    const { lines } = parseScanPage({
      traceId: 't',
      data: {
        contents: [{ content: { order, productOrder: po } }],
        pagination: { hasNext: false },
      },
    })
    for (const l of lines) expect(ScanLineInputSchema.safeParse(l).error).toBeUndefined()
  })
  it('쿠팡 행(취소·송장 포함)', () => {
    const rows = parseSheet({
      shipmentBoxId: 1,
      orderId: 2,
      paidAt: '2026-11-24T09:01:00',
      status: 'DELIVERING',
      deliveryCompanyName: 'CJ',
      invoiceNumber: 99,
      inTrasitDateTime: '2026-11-24 12:00:00',
      orderItems: [
        {
          vendorItemId: 3,
          sellerProductName: 'n',
          shippingCount: 1,
          canceled: true,
          estimatedShippingDate: '2026-11-26',
        },
      ],
    })
    for (const r of rows) {
      expect(OrderLineInputSchema.safeParse(r).error).toBeUndefined()
      expect(r.externalLineKey).toBe('1:3')
    }
  })
})
