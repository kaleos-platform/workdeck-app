/** @jest-environment node */

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn().mockResolvedValue({ space: { id: 'space-1' } }),
  errorResponse: (message: string, status: number) => ({
    status,
    json: async () => ({ message }),
  }),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    delOrder: {
      findMany: jest.fn(),
    },
  },
}))

jest.mock('@/lib/del/encryption', () => ({
  decryptPii: jest.fn((value: string) => value),
  encryptOrderPii: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const findMany = jest.mocked(prisma.delOrder.findMany)

function request(query: string): Parameters<typeof GET>[0] {
  return { nextUrl: new URL(`http://localhost/api/sh/shipping/orders${query}`) } as Parameters<
    typeof GET
  >[0]
}

const paymentOrder = {
  id: 'order-payment',
  orderNumber: 'ORDER-001',
  orderDate: new Date('2026-09-24T00:00:00.000Z'),
  paymentAmount: '39000.00',
  postalCode: '06236',
  deliveryMessage: null,
  memo: null,
  recipientNameEnc: '홍길동',
  recipientNameIv: 'name-iv',
  phoneEnc: '010-1234-5678',
  phoneIv: 'phone-iv',
  addressEnc: '서울시 강남구 역삼동 123',
  addressIv: 'address-iv',
  channel: { id: 'channel-1', name: '자사몰' },
  shippingMethod: { id: 'method-1', name: '택배' },
  items: [{ name: '일반 상품', quantity: 1 }],
}

describe('GET /api/sh/shipping/orders', () => {
  beforeEach(() => {
    findMany.mockReset()
    findMany.mockResolvedValue([paymentOrder] as never)
  })

  test('결제금액으로 전체 주문을 찾고 PII를 마스킹한다', async () => {
    const response = (await GET(request('?q=39%2C000%EC%9B%90')))!
    const body = await response.json()

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { spaceId: 'space-1', batch: { status: 'COMPLETED' } },
      })
    )
    expect(body.total).toBe(1)
    expect(body.data).toEqual([
      expect.objectContaining({
        id: 'order-payment',
        paymentAmount: '39000.00',
        recipientName: '홍**',
        phone: '010-****-5678',
        address: '서울시 강남구 ****',
      }),
    ])
  })
})
