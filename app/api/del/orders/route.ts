import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { encryptOrderPii } from '@/lib/del/encryption'

type OrderInput = {
  shippingMethodId: string
  channelId?: string | null
  recipientName: string
  phone: string
  address: string
  postalCode?: string | null
  deliveryMessage?: string | null
  memo?: string | null
  orderDate: string
  orderNumber?: string | null
  paymentAmount?: number | null
  items?: { name: string; quantity: number }[]
}

const MAX_ITEMS_PER_ORDER = 10

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const batchId = typeof body?.batchId === 'string' ? body.batchId : ''
  const ordersInput = Array.isArray(body?.orders) ? body.orders as OrderInput[] : []

  if (!batchId) return errorResponse('batchId가 필요합니다', 400)
  if (ordersInput.length === 0) return errorResponse('orders 배열이 필요합니다', 400)

  // 배치 확인
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    select: { spaceId: true, status: true },
  })
  if (!batch || batch.spaceId !== resolved.space.id) {
    return errorResponse('배치를 찾을 수 없습니다', 404)
  }
  if (batch.status !== 'DRAFT') {
    return errorResponse('완료된 배치에는 주문을 추가할 수 없습니다', 400)
  }

  // 주문 일괄 생성
  const createdOrders = []
  const errors: { index: number; message: string }[] = []

  for (let i = 0; i < ordersInput.length; i++) {
    const input = ordersInput[i]
    if (!input.recipientName || !input.phone || !input.address || !input.shippingMethodId || !input.orderDate) {
      errors.push({ index: i, message: '필수 필드가 누락되었습니다 (받는분, 전화, 주소, 배송방식, 주문일자)' })
      continue
    }

    const items = (input.items ?? []).slice(0, MAX_ITEMS_PER_ORDER)
    const encrypted = encryptOrderPii({
      recipientName: input.recipientName,
      phone: input.phone,
      address: input.address,
    })

    try {
      const order = await prisma.delOrder.create({
        data: {
          spaceId: resolved.space.id,
          batchId,
          shippingMethodId: input.shippingMethodId,
          channelId: input.channelId || null,
          ...encrypted,
          postalCode: input.postalCode || null,
          deliveryMessage: input.deliveryMessage || null,
          memo: input.memo || null,
          orderDate: new Date(input.orderDate),
          orderNumber: input.orderNumber || null,
          paymentAmount: input.paymentAmount != null ? input.paymentAmount : null,
          items: {
            create: items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
            })),
          },
        },
        include: { items: true },
      })
      createdOrders.push(order.id)
    } catch (err) {
      errors.push({ index: i, message: err instanceof Error ? err.message : '생성 실패' })
    }
  }

  return NextResponse.json(
    { created: createdOrders.length, errors, orderIds: createdOrders },
    { status: 201 }
  )
}
