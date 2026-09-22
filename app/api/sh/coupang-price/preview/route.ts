import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { deriveListings } from '@/lib/sh/coupang-price/listing-derive'
import { buildPreviewTargets } from '@/lib/sh/coupang-price/build-targets'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'

const previewBodySchema = z.object({
  channelId: z.string().min(1),
  optionIds: z.array(z.string().min(1)).min(1),
  quantity: z.number().int().positive(),
  salePrice: z.number().positive(),
  minMarginPrice: z.number().positive(),
  includeVat: z.boolean(),
})

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const parsed = previewBodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

  const channel = await prisma.channel.findFirst({
    where: { id: input.channelId, spaceId: resolved.space.id },
    select: { id: true, externalSource: true, representativeChannelId: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  // 로켓그로스 등 연동(자체배송) 채널은 판매채널 상품을 갖지 않고 대표 채널 것을 미러링한다.
  const listingChannelId = channel.representativeChannelId ?? channel.id
  const channelAxis = channel.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH ? 'RG' : 'MP'

  const listings = await prisma.productListing.findMany({
    where: { spaceId: resolved.space.id, channelId: listingChannelId },
    select: {
      id: true,
      displayName: true,
      items: { select: { optionId: true, quantity: true } },
    },
  })

  const derived = deriveListings(
    { optionIds: input.optionIds, quantity: input.quantity },
    listings.map((l) => ({ id: l.id, items: l.items }))
  )

  const nameById = new Map(listings.map((l) => [l.id, l.displayName]))

  const items = await prisma.coupangProductItem.findMany({
    where: { spaceId: resolved.space.id, listingId: { in: derived.matched } },
    select: {
      listingId: true,
      rgVendorItemId: true,
      mpVendorItemId: true,
      rgSalePrice: true,
      mpSalePrice: true,
      collectedAt: true,
      sellerProductId: true,
    },
  })

  const targets = buildPreviewTargets({
    channelAxis,
    salePrice: input.salePrice,
    minMarginPrice: input.minMarginPrice,
    includeVat: input.includeVat,
    now: new Date(),
    listings: derived.matched.map((id) => ({ id, name: nameById.get(id) ?? '' })),
    items: items
      .filter((i): i is typeof i & { listingId: string } => i.listingId !== null)
      .map((i) => ({ ...i, listingId: i.listingId })),
  })

  // 판매채널 상품이 하나도 없는 옵션 — 이름을 붙여 돌려준다(화면 경고용).
  const unmatchedOptions = derived.unmatched.length
    ? await prisma.invProductOption.findMany({
        // product 릴레이션으로 space 스코프를 건다 — optionIds 는 클라이언트 입력이고,
        // 다른 space 의 옵션 id 는 정의상 매칭이 없어 그대로 unmatched 에 들어온다.
        where: { id: { in: derived.unmatched }, product: { spaceId: resolved.space.id } },
        select: { id: true, name: true },
      })
    : []

  return NextResponse.json({
    targets,
    // 시그니처가 리스팅 여러 개와 동시에 매칭되면 어느 것인지 사람이 골라야 한다.
    ambiguous: derived.ambiguous.map((ids) =>
      ids.map((id) => ({ id, name: nameById.get(id) ?? '' }))
    ),
    unmatched: derived.unmatched.map((id) => ({
      id,
      name: unmatchedOptions.find((o) => o.id === id)?.name ?? id,
    })),
  })
}
