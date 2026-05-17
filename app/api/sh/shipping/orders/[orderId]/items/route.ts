import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ orderId: string }> }

/**
 * POST /api/sh/shipping/orders/[orderId]/items
 *
 * 저장된 주문에 신규 아이템을 추가한다. 매칭(optionId/listingId)은 없는 상태로 생성하고,
 * 사용자가 이후 매칭 다이얼로그로 채운다.
 *
 * body: { name: string, quantity: number }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { orderId } = await params

  const order = await prisma.delOrder.findFirst({
    where: { id: orderId },
    select: { id: true, spaceId: true },
  })
  if (!order || order.spaceId !== resolved.space.id) {
    return errorResponse('주문을 찾을 수 없습니다', 404)
  }

  const body = await req.json().catch(() => ({}))
  const rawName = typeof body?.name === 'string' ? body.name.trim() : ''
  const rawQty = body?.quantity

  if (!rawName) return errorResponse('상품명이 필요합니다', 400)

  let quantity = 1
  if (typeof rawQty === 'number' && Number.isFinite(rawQty)) {
    quantity = Math.max(1, Math.floor(rawQty))
  } else if (typeof rawQty === 'string' && rawQty.trim() !== '') {
    const n = Number(rawQty)
    if (Number.isFinite(n)) quantity = Math.max(1, Math.floor(n))
  }

  const created = await prisma.delOrderItem.create({
    data: { orderId, name: rawName, quantity },
    select: { id: true, name: true, quantity: true },
  })

  return NextResponse.json({ ok: true, item: created })
}
