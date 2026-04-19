import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { encryptOrderPii } from '@/lib/del/encryption'

type Params = { params: Promise<{ orderId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const { orderId } = await params
  const order = await prisma.delOrder.findUnique({
    where: { id: orderId },
    include: { batch: { select: { status: true } } },
  })
  if (!order || order.spaceId !== resolved.space.id) {
    return errorResponse('주문을 찾을 수 없습니다', 404)
  }
  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  // PII 필드 업데이트 (3개 모두 제공되어야 함)
  const trimmedName = typeof body?.recipientName === 'string' ? body.recipientName.trim() : ''
  const trimmedPhone = typeof body?.phone === 'string' ? body.phone.trim() : ''
  const trimmedAddress = typeof body?.address === 'string' ? body.address.trim() : ''
  if (trimmedName && trimmedPhone && trimmedAddress) {
    const encrypted = encryptOrderPii({
      recipientName: trimmedName,
      phone: trimmedPhone,
      address: trimmedAddress,
    })
    Object.assign(data, encrypted)
  }

  if (typeof body?.postalCode === 'string') data.postalCode = body.postalCode || null
  if (typeof body?.deliveryMessage === 'string') data.deliveryMessage = body.deliveryMessage || null
  if (body?.shippingMethodId !== undefined) {
    data.shippingMethodId =
      typeof body.shippingMethodId === 'string' ? body.shippingMethodId || null : null
  }
  if (body?.channelId !== undefined) data.channelId = body.channelId || null
  if (typeof body?.orderDate === 'string') data.orderDate = new Date(body.orderDate)
  if (typeof body?.orderNumber === 'string') data.orderNumber = body.orderNumber || null
  if (body?.paymentAmount !== undefined) {
    data.paymentAmount = body.paymentAmount != null ? Number(body.paymentAmount) : null
  }
  if (typeof body?.memo === 'string') data.memo = body.memo || null

  // 상품 업데이트
  if (Array.isArray(body?.items)) {
    await prisma.delOrderItem.deleteMany({ where: { orderId } })
    await prisma.delOrderItem.createMany({
      data: body.items.slice(0, 10).map((item: { name: string; quantity: number }) => ({
        orderId,
        name: item.name,
        quantity: item.quantity,
      })),
    })
  }

  if (Object.keys(data).length > 0) {
    await prisma.delOrder.update({ where: { id: orderId }, data })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const { orderId } = await params
  const order = await prisma.delOrder.findUnique({
    where: { id: orderId },
    include: { batch: { select: { status: true } } },
  })
  if (!order || order.spaceId !== resolved.space.id) {
    return errorResponse('주문을 찾을 수 없습니다', 404)
  }

  await prisma.delOrder.delete({ where: { id: orderId } })

  return NextResponse.json({ success: true })
}
