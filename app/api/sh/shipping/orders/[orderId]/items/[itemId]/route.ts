import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ orderId: string; itemId: string }> }

/**
 * PATCH /api/sh/shipping/orders/[orderId]/items/[itemId]
 *
 * body: { quantity?: number }
 *
 * 수량 변경 시 fulfillments 자동 재계산:
 *  - listing 매칭: listing.items 재조회 후 `composition × newQty`로 재생성
 *  - 단일 옵션 매칭: fulfillments 없음 — item.quantity만 업데이트
 *  - 수동 입력: 기존 fulfillment의 perSet(= oldQty / oldItemQty)을 유지하고 newQty로 스케일
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { orderId, itemId } = await params

  const body = await req.json().catch(() => ({}))
  const rawQty = body?.quantity

  const item = await prisma.delOrderItem.findFirst({
    where: { id: itemId, orderId },
    include: {
      order: { select: { spaceId: true } },
      fulfillments: { select: { id: true, optionId: true, quantity: true } },
      listing: { include: { items: { select: { optionId: true, quantity: true } } } },
    },
  })
  if (!item || item.order.spaceId !== resolved.space.id) {
    return errorResponse('주문 아이템을 찾을 수 없습니다', 404)
  }

  const oldQty = item.quantity
  let newQty = oldQty

  if (typeof rawQty === 'number' && Number.isFinite(rawQty)) {
    const clamped = Math.max(1, Math.floor(rawQty))
    newQty = clamped
  } else if (typeof rawQty === 'string' && rawQty.trim() !== '') {
    const n = Number(rawQty)
    if (Number.isFinite(n)) newQty = Math.max(1, Math.floor(n))
  }

  if (newQty === oldQty) {
    return NextResponse.json({ ok: true, noChange: true })
  }

  await prisma.$transaction(async (tx) => {
    await tx.delOrderItem.update({
      where: { id: itemId },
      data: { quantity: newQty },
    })

    if (item.listingId && item.listing) {
      // listing 매칭 — composition 기반으로 재생성
      await tx.delOrderItemFulfillment.deleteMany({ where: { orderItemId: itemId } })
      if (item.listing.items.length > 0) {
        await tx.delOrderItemFulfillment.createMany({
          data: item.listing.items.map((li) => ({
            orderItemId: itemId,
            optionId: li.optionId,
            quantity: li.quantity * newQty,
          })),
        })
      }
    } else if (item.fulfillments.length > 0) {
      // 수동 입력 등 — perSet 유지하며 newQty로 스케일
      for (const f of item.fulfillments) {
        const perSet = oldQty > 0 ? f.quantity / oldQty : 0
        const scaled = Math.max(1, Math.round(perSet * newQty))
        await tx.delOrderItemFulfillment.update({
          where: { id: f.id },
          data: { quantity: scaled },
        })
      }
    }
    // 단일 옵션 매칭 (optionId만 있고 fulfillments 없음): 수량만 업데이트
  })

  const fresh = await prisma.delOrderItem.findUnique({
    where: { id: itemId },
    include: {
      fulfillments: {
        include: {
          option: {
            select: {
              id: true,
              name: true,
              product: { select: { id: true, name: true, internalName: true } },
            },
          },
        },
      },
    },
  })

  return NextResponse.json({
    ok: true,
    item: {
      id: fresh!.id,
      quantity: fresh!.quantity,
      fulfillments: fresh!.fulfillments.map((f) => {
        const prod = f.option.product
        const displayName =
          prod.internalName && prod.internalName.trim().length > 0 ? prod.internalName : prod.name
        return {
          id: f.id,
          optionId: f.optionId,
          quantity: f.quantity,
          optionName: f.option.name,
          productId: prod.id,
          productName: displayName,
        }
      }),
    },
  })
}
