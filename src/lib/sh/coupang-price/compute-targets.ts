import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { deriveListings } from './listing-derive'
import { buildPreviewTargets, type PreviewTarget } from './build-targets'

export const priceInputSchema = z.object({
  channelId: z.string().min(1),
  rows: z
    .array(
      z.object({
        optionIds: z.array(z.string().min(1)).min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
  salePrice: z.number().positive(),
  minMarginPrice: z.number().positive(),
  includeVat: z.boolean(),
})
export type PriceInput = z.infer<typeof priceInputSchema>

export type ComputedTargets = {
  channelId: string
  channelAxis: 'RG' | 'MP'
  targets: PreviewTarget[]
  ambiguous: Array<Array<{ id: string; name: string }>>
  unmatched: Array<{ id: string; name: string }>
}

/**
 * 미리보기와 반영이 같은 계산을 쓴다 — 반영 라우트는 클라이언트가 보낸 타깃을 믿지 않고
 * 이 함수로 다시 계산한다(미리보기 이후 매핑이 바뀌었어도 서버 기준이 이긴다).
 */
export async function computePriceTargets(
  spaceId: string,
  input: PriceInput
): Promise<ComputedTargets | { error: string; status: number }> {
  const channel = await prisma.channel.findFirst({
    where: { id: input.channelId, spaceId },
    select: { id: true, externalSource: true, representativeChannelId: true },
  })
  if (!channel) return { error: '채널을 찾을 수 없습니다', status: 404 }

  // 로켓그로스 등 연동 채널은 판매채널 상품을 갖지 않고 대표 채널 것을 미러링한다.
  const listingChannelId = channel.representativeChannelId ?? channel.id
  const channelAxis = channel.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH ? 'RG' : 'MP'

  const listings = await prisma.productListing.findMany({
    where: { spaceId, channelId: listingChannelId },
    select: { id: true, displayName: true, items: { select: { optionId: true, quantity: true } } },
  })
  const derived = deriveListings(
    input.rows,
    listings.map((l) => ({ id: l.id, items: l.items }))
  )
  const nameById = new Map(listings.map((l) => [l.id, l.displayName]))

  const items = await prisma.coupangProductItem.findMany({
    // 매칭 안 함 항목엔 절대 가격을 쓰지 않는다 — 제외 시 연결도 끊지만 이중 방어.
    where: { spaceId, listingId: { in: derived.matched }, excludedAt: null },
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

  // optionIds 는 클라이언트 입력 — product 릴레이션으로 space 스코프를 건다.
  const unmatchedOptions = derived.unmatched.length
    ? await prisma.invProductOption.findMany({
        where: { id: { in: derived.unmatched }, product: { spaceId } },
        select: { id: true, name: true },
      })
    : []

  return {
    channelId: channel.id,
    channelAxis,
    targets,
    ambiguous: derived.ambiguous.map((ids) =>
      ids.map((id) => ({ id, name: nameById.get(id) ?? '' }))
    ),
    unmatched: derived.unmatched.map((id) => ({
      id,
      name: unmatchedOptions.find((o) => o.id === id)?.name ?? id,
    })),
  }
}
