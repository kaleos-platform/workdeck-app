import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { normalizeAlias } from '@/lib/sh/product-matching'

type Params = { params: Promise<{ orderId: string; itemId: string }> }

/**
 * PATCH /api/sh/shipping/orders/[orderId]/items/[itemId]/match
 * body: { optionId: string | null, saveAlias?: boolean }
 *
 * - optionId 로 DelOrderItem 을 매칭 (null 전달 시 매칭 해제)
 * - saveAlias(default true) + order 에 channelId 있고 optionId 존재하면
 *   ChannelProductAlias 를 upsert (정규화된 item.name 으로)
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { orderId, itemId } = await params

  const body = await req.json().catch(() => ({}))
  const rawOptionId = body?.optionId
  const optionId = typeof rawOptionId === 'string' && rawOptionId.trim() !== '' ? rawOptionId : null
  const saveAlias = body?.saveAlias !== false // default true

  const item = await prisma.delOrderItem.findFirst({
    where: { id: itemId, orderId },
    include: {
      order: {
        select: { id: true, spaceId: true, channelId: true },
      },
    },
  })
  if (!item || item.order.spaceId !== resolved.space.id) {
    return errorResponse('주문 아이템을 찾을 수 없습니다', 404)
  }

  if (optionId) {
    const option = await prisma.invProductOption.findFirst({
      where: { id: optionId, product: { spaceId: resolved.space.id } },
      select: { id: true, name: true, product: { select: { id: true, name: true } } },
    })
    if (!option) return errorResponse('옵션을 찾을 수 없습니다', 400)

    await prisma.delOrderItem.update({
      where: { id: itemId },
      data: { optionId },
    })

    if (saveAlias && item.order.channelId) {
      const aliasName = normalizeAlias(item.name)
      if (aliasName) {
        await prisma.channelProductAlias.upsert({
          where: {
            channelId_aliasName: {
              channelId: item.order.channelId,
              aliasName,
            },
          },
          update: { optionId },
          create: {
            spaceId: resolved.space.id,
            channelId: item.order.channelId,
            aliasName,
            optionId,
          },
        })
      }
    }

    return NextResponse.json({
      ok: true,
      optionId,
      option: {
        id: option.id,
        name: option.name,
        product: option.product,
      },
      aliasSaved: saveAlias && !!item.order.channelId,
    })
  }

  // optionId null → 매칭 해제 (별칭은 남겨둠)
  await prisma.delOrderItem.update({
    where: { id: itemId },
    data: { optionId: null },
  })

  return NextResponse.json({ ok: true, optionId: null })
}
