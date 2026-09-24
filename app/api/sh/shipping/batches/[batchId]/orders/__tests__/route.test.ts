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
    delBatch: {
      findUnique: jest.fn(),
    },
    delOrder: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}))

jest.mock('@/lib/del/encryption', () => ({
  decryptPii: jest.fn((value: string) => value),
}))

import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const findBatch = jest.mocked(prisma.delBatch.findUnique)
const findOrders = jest.mocked(prisma.delOrder.findMany)
const countOrders = jest.mocked(prisma.delOrder.count)

function request(query: string): Parameters<typeof GET>[0] {
  return {
    nextUrl: new URL(`http://localhost/api/sh/shipping/batches/batch-1/orders${query}`),
  } as Parameters<typeof GET>[0]
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-payment',
    recipientNameEnc: '홍길동',
    recipientNameIv: 'name-iv',
    phoneEnc: '010-1234-5678',
    phoneIv: 'phone-iv',
    addressEnc: '서울시 강남구 역삼동 123',
    addressIv: 'address-iv',
    postalCode: '06236',
    deliveryMessage: null,
    memo: null,
    orderDate: new Date('2026-09-24T00:00:00.000Z'),
    orderNumber: 'ORDER-001',
    paymentAmount: '39000.00',
    channel: { id: 'channel-1', name: '자사몰' },
    shippingMethod: { id: 'method-1', name: '택배' },
    items: [
      {
        id: 'item-1',
        name: '일반 상품',
        quantity: 1,
        optionId: null,
        listingId: null,
        option: null,
        listing: null,
        fulfillments: [],
      },
    ],
    createdAt: new Date('2026-09-24T00:00:00.000Z'),
    ...overrides,
  }
}

describe('GET /api/sh/shipping/batches/[batchId]/orders', () => {
  beforeEach(() => {
    findBatch.mockReset()
    findOrders.mockReset()
    countOrders.mockReset()
    findBatch.mockResolvedValue({ spaceId: 'space-1', status: 'COMPLETED' } as never)
    findOrders.mockResolvedValue([
      order(),
      order({
        id: 'order-item',
        paymentAmount: null,
        items: [
          {
            id: 'item-2',
            name: '특가 39000 세트',
            quantity: 1,
            optionId: null,
            listingId: null,
            option: null,
            listing: null,
            fulfillments: [],
          },
        ],
      }),
    ] as never)
  })

  test('결제금액 검색을 기존 상품명 OR 검색과 함께 적용한다', async () => {
    const response = (await GET(request('?q=39000'), {
      params: Promise.resolve({ batchId: 'batch-1' }),
    }))!
    const body = await response.json()

    expect(findOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { batchId: 'batch-1', spaceId: 'space-1' },
        take: 500,
      })
    )
    expect(countOrders).not.toHaveBeenCalled()
    expect(body.total).toBe(2)
    expect(body.page).toBe(1)
    expect(body.data.map((item: { id: string }) => item.id)).toEqual([
      'order-payment',
      'order-item',
    ])
    expect(body.data[0]).toEqual(
      expect.objectContaining({
        paymentAmount: '39000.00',
        recipientName: '홍**',
        phone: '010-****-5678',
        address: '서울시 강남구 ****',
      })
    )
  })
})
