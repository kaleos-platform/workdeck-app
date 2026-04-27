import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { encryptOrderPii } from '@/lib/del/encryption'

type OrderInput = {
  shippingMethodId?: string | null
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
  items?: { name: string; quantity: number; optionId?: string | null }[]
}

const MAX_ITEMS_PER_ORDER = 10

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const batchId = typeof body?.batchId === 'string' ? body.batchId : ''
  const ordersInput = Array.isArray(body?.orders) ? (body.orders as OrderInput[]) : []

  if (!batchId) return errorResponse('batchId가 필요합니다', 400)
  if (ordersInput.length === 0) return errorResponse('orders 배열이 필요합니다', 400)

  // 배송 묶음 확인
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    select: { spaceId: true, status: true },
  })
  if (!batch || batch.spaceId !== resolved.space.id) {
    return errorResponse('배송 묶음을 찾을 수 없습니다', 404)
  }
  if (batch.status !== 'DRAFT') {
    return errorResponse('완료된 배송 묶음에는 주문을 추가할 수 없습니다', 400)
  }

  // 주문 일괄 생성 — 각 input index에 대해 성공이면 order, 실패면 null
  const resultByIndex: Array<{
    index: number
    id: string
    items: Array<{ id: string; name: string; quantity: number }>
  } | null> = new Array(ordersInput.length).fill(null)
  const errors: { index: number; message: string }[] = []

  for (let i = 0; i < ordersInput.length; i++) {
    const input = ordersInput[i]
    if (!input.recipientName || !input.phone || !input.address || !input.orderDate) {
      errors.push({
        index: i,
        message: '필수 필드가 누락되었습니다 (받는분, 전화, 주소, 주문일자)',
      })
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
          shippingMethodId: input.shippingMethodId || null,
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
              optionId: item.optionId ?? null,
            })),
          },
        },
        include: { items: true },
      })
      resultByIndex[i] = {
        index: i,
        id: order.id,
        items: order.items.map((it) => ({ id: it.id, name: it.name, quantity: it.quantity })),
      }
    } catch (err) {
      errors.push({ index: i, message: err instanceof Error ? err.message : '생성 실패' })
    }
  }

  const createdOrders = resultByIndex.filter(
    (
      v
    ): v is {
      index: number
      id: string
      items: Array<{ id: string; name: string; quantity: number }>
    } => v !== null
  )

  return NextResponse.json(
    {
      created: createdOrders.length,
      errors,
      orderIds: createdOrders.map((o) => o.id),
      // 각 성공 주문의 원본 input index + id + items — 클라이언트가 tempId → 실제 id 매핑 시 사용
      orders: createdOrders,
    },
    { status: 201 }
  )
}
