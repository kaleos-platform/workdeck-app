import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import {
  computeEffectiveStatus,
  computeListingAvailableStock,
  computeListingRetailBaseline,
} from '@/lib/sh/listing-calc'

type Params = { params: Promise<{ productId: string }> }

/**
 * 상품 상세의 "판매채널 현황" 섹션에서 사용.
 * 해당 상품의 옵션이 참여한 ProductListing 목록을 반환.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  // 상품 소속 검증
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  // 이 상품의 옵션 중 하나라도 포함된 listing
  const listings = await prisma.productListing.findMany({
    where: {
      spaceId: resolved.space.id,
      items: { some: { option: { productId } } },
    },
    include: {
      channel: { select: { id: true, name: true } },
      items: {
        include: {
          option: {
            select: {
              id: true,
              name: true,
              productId: true,
              retailPrice: true,
            },
          },
        },
      },
    },
    orderBy: [{ channelId: 'asc' }, { updatedAt: 'desc' }],
  })

  // 재고 배치 조회
  const optionIds = Array.from(new Set(listings.flatMap((l) => l.items.map((i) => i.optionId))))
  const stockMap = new Map<string, number>()
  if (optionIds.length > 0) {
    const rows = await prisma.invStockLevel.groupBy({
      by: ['optionId'],
      where: { optionId: { in: optionIds } },
      _sum: { quantity: true },
    })
    for (const r of rows) stockMap.set(r.optionId, r._sum.quantity ?? 0)
  }

  const data = listings.map((l) => {
    const mine = l.items.filter((it) => it.option.productId === productId)
    const priceSnapshots = l.items.map((it) => ({
      quantity: it.quantity,
      retailPrice: it.option.retailPrice != null ? Number(it.option.retailPrice) : null,
    }))
    const stockSnapshots = l.items.map((it) => ({
      quantity: it.quantity,
      optionStock: stockMap.get(it.optionId) ?? 0,
    }))
    const baseline = computeListingRetailBaseline(priceSnapshots)
    const retailPrice = l.retailPrice != null ? Number(l.retailPrice) : null
    const available = computeListingAvailableStock(stockSnapshots)
    const effective = computeEffectiveStatus(l.status, available)

    return {
      listingId: l.id,
      channelId: l.channelId,
      channelName: l.channel.name,
      searchName: l.searchName,
      displayName: l.displayName,
      retailPrice,
      baselinePrice: baseline,
      availableStock: available,
      status: l.status,
      effectiveStatus: effective,
      itemCount: l.items.length,
      myOptionsInListing: mine.map((it) => ({
        optionId: it.optionId,
        optionName: it.option.name,
        quantity: it.quantity,
      })),
    }
  })

  return NextResponse.json({ data })
}
