import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { normalizeAlias } from '@/lib/sh/product-matching'

type Params = { params: Promise<{ orderId: string; itemId: string }> }

/**
 * PATCH /api/sh/shipping/orders/[orderId]/items/[itemId]/match
 * body:
 *   { mode: 'listing', listingId: string, saveAlias?: boolean }
 *   { mode: 'option',  optionId: string,  saveAlias?: boolean }
 *   { mode: 'clear' }   // 매칭 해제 (별칭은 남김)
 *
 * 하위 호환: { optionId } 만 전달하면 'option' 모드로 처리.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { orderId, itemId } = await params

  const body = await req.json().catch(() => ({}))
  let mode: 'listing' | 'option' | 'clear' =
    typeof body?.mode === 'string' &&
    (body.mode === 'listing' || body.mode === 'option' || body.mode === 'clear')
      ? body.mode
      : 'option'
  const rawOptionId = body?.optionId
  const rawListingId = body?.listingId
  const saveAlias = body?.saveAlias !== false // default true

  // 하위 호환: mode 없이 optionId만 온 경우
  if (!body?.mode) {
    mode = rawOptionId ? 'option' : 'clear'
  }

  const item = await prisma.delOrderItem.findFirst({
    where: { id: itemId, orderId },
    include: {
      order: { select: { id: true, spaceId: true, channelId: true } },
    },
  })
  if (!item || item.order.spaceId !== resolved.space.id) {
    return errorResponse('주문 아이템을 찾을 수 없습니다', 404)
  }

  if (mode === 'listing') {
    const listingId =
      typeof rawListingId === 'string' && rawListingId.trim() !== '' ? rawListingId : null
    if (!listingId) return errorResponse('listingId가 필요합니다', 400)

    const listing = await prisma.productListing.findFirst({
      where: { id: listingId, spaceId: resolved.space.id },
      include: {
        items: { select: { optionId: true, quantity: true } },
        channel: { select: { id: true } },
      },
    })
    if (!listing) return errorResponse('판매채널 상품을 찾을 수 없습니다', 400)

    // orderItem 수량 × 구성 수량으로 fulfillments 생성
    const qty = item.quantity
    await prisma.$transaction(async (tx) => {
      await tx.delOrderItem.update({
        where: { id: itemId },
        data: { optionId: null, listingId },
      })
      await tx.delOrderItemFulfillment.deleteMany({ where: { orderItemId: itemId } })
      if (listing.items.length > 0) {
        await tx.delOrderItemFulfillment.createMany({
          data: listing.items.map((li) => ({
            orderItemId: itemId,
            optionId: li.optionId,
            quantity: li.quantity * qty,
          })),
        })
      }
    })

    if (saveAlias && item.order.channelId) {
      const aliasName = normalizeAlias(item.name)
      if (aliasName) {
        await prisma.channelProductAlias.upsert({
          where: { channelId_aliasName: { channelId: item.order.channelId, aliasName } },
          update: { listingId, optionId: null },
          create: {
            spaceId: resolved.space.id,
            channelId: item.order.channelId,
            aliasName,
            listingId,
            optionId: null,
          },
        })
      }
    }

    return NextResponse.json({
      ok: true,
      mode: 'listing',
      listingId,
      listing: {
        id: listing.id,
        searchName: listing.searchName,
        displayName: listing.displayName,
      },
      aliasSaved: saveAlias && !!item.order.channelId,
    })
  }

  if (mode === 'option') {
    const optionId =
      typeof rawOptionId === 'string' && rawOptionId.trim() !== '' ? rawOptionId : null
    if (!optionId) return errorResponse('optionId가 필요합니다', 400)

    const option = await prisma.invProductOption.findFirst({
      where: { id: optionId, product: { spaceId: resolved.space.id } },
      select: { id: true, name: true, product: { select: { id: true, name: true } } },
    })
    if (!option) return errorResponse('옵션을 찾을 수 없습니다', 400)

    await prisma.$transaction(async (tx) => {
      await tx.delOrderItem.update({
        where: { id: itemId },
        data: { optionId, listingId: null },
      })
      await tx.delOrderItemFulfillment.deleteMany({ where: { orderItemId: itemId } })
    })

    if (saveAlias && item.order.channelId) {
      const aliasName = normalizeAlias(item.name)
      if (aliasName) {
        await prisma.channelProductAlias.upsert({
          where: { channelId_aliasName: { channelId: item.order.channelId, aliasName } },
          update: { optionId, listingId: null },
          create: {
            spaceId: resolved.space.id,
            channelId: item.order.channelId,
            aliasName,
            optionId,
            listingId: null,
          },
        })
      }
    }

    return NextResponse.json({
      ok: true,
      mode: 'option',
      optionId,
      option: {
        id: option.id,
        name: option.name,
        product: option.product,
      },
      aliasSaved: saveAlias && !!item.order.channelId,
    })
  }

  // clear
  await prisma.$transaction(async (tx) => {
    await tx.delOrderItem.update({
      where: { id: itemId },
      data: { optionId: null, listingId: null },
    })
    await tx.delOrderItemFulfillment.deleteMany({ where: { orderItemId: itemId } })
  })
  return NextResponse.json({ ok: true, mode: 'clear' })
}
