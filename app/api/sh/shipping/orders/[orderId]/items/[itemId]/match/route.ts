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
 *   { mode: 'manual',  fulfillments: [{ optionId, quantity }] }  // 카탈로그에 없는 복합 구성 수동 입력
 *   { mode: 'clear' }   // 매칭 해제 (별칭은 남김)
 *
 * 하위 호환: { optionId } 만 전달하면 'option' 모드로 처리.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { orderId, itemId } = await params

  const body = await req.json().catch(() => ({}))
  let mode: 'listing' | 'option' | 'manual' | 'clear' =
    typeof body?.mode === 'string' &&
    (body.mode === 'listing' ||
      body.mode === 'option' ||
      body.mode === 'manual' ||
      body.mode === 'clear')
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

  if (mode === 'manual') {
    // 사용자가 입력하는 값은 "1 주문당" per-set 수량. 저장 시 orderItem.quantity를 곱해 총 출고 수량으로 스토어.
    // (listing 매칭과 동일한 의미론: fulfillment.quantity = perSet × orderItem.quantity)
    type ManualFulfillment = { optionId: string; perSetQuantity: number }
    const raw: unknown[] = Array.isArray(body?.fulfillments) ? body.fulfillments : []
    const list: ManualFulfillment[] = []
    for (const f of raw) {
      if (typeof f !== 'object' || !f) continue
      const optionId = (f as { optionId?: unknown }).optionId
      const quantity = Number((f as { quantity?: unknown }).quantity)
      if (typeof optionId !== 'string' || !optionId.trim()) continue
      if (!Number.isFinite(quantity) || quantity < 1) continue
      list.push({ optionId, perSetQuantity: Math.floor(quantity) })
    }
    if (list.length === 0) return errorResponse('출고 옵션을 1개 이상 입력해 주세요', 400)
    if (list.length > 50) return errorResponse('출고 옵션은 최대 50개까지 입력 가능합니다', 400)

    const optionIds: string[] = Array.from(new Set(list.map((f) => f.optionId)))
    const validOptions = await prisma.invProductOption.findMany({
      where: { id: { in: optionIds }, product: { spaceId: resolved.space.id } },
      select: { id: true },
    })
    if (validOptions.length !== optionIds.length) {
      return errorResponse('유효하지 않은 옵션이 포함되어 있습니다', 400)
    }

    const orderQty = item.quantity
    await prisma.$transaction(async (tx) => {
      await tx.delOrderItem.update({
        where: { id: itemId },
        data: { optionId: null, listingId: null },
      })
      await tx.delOrderItemFulfillment.deleteMany({ where: { orderItemId: itemId } })
      await tx.delOrderItemFulfillment.createMany({
        data: list.map((f) => ({
          orderItemId: itemId,
          optionId: f.optionId,
          quantity: f.perSetQuantity * orderQty,
        })),
      })
    })

    const totalQuantity = list.reduce((s, f) => s + f.perSetQuantity * orderQty, 0)
    return NextResponse.json({
      ok: true,
      mode: 'manual',
      fulfillmentCount: list.length,
      totalQuantity,
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
