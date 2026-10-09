import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { tokenizeProductName } from '@/lib/inv/search-tokens'
import {
  LISTING_SELECT,
  resolveCoupangListingChannelId,
  summarize,
  type LoadedListing,
} from '@/lib/sh/coupang-price/load-matching'

const PAGE_SIZE = 50

/**
 * GET /api/sh/coupang-price/listings?search= — 매칭 화면 "다른 상품 선택" 팝업용.
 * 쿠팡 리스팅 채널의 판매채널 상품 중 아직 연결되지 않은(또는 이 옵션에 연결된) 것을 구성·판매가와 함께 돌려준다.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const channelId = await resolveCoupangListingChannelId(spaceId)
  if (!channelId) return NextResponse.json({ listings: [] })

  // 고르는 쿠팡 옵션 — 다른 쿠팡 옵션에 이미 연결된 상품은 고를 수 없으니 결과에서 뺀다.
  const itemId = req.nextUrl.searchParams.get('itemId')
  const tokens = tokenizeProductName((req.nextUrl.searchParams.get('search') ?? '').trim())
  const listings = await prisma.productListing.findMany({
    where: {
      spaceId,
      channelId,
      OR: [
        { coupangProductItem: null },
        ...(itemId ? [{ coupangProductItem: { id: itemId } }] : []),
      ],
      ...(tokens.length > 0
        ? {
            AND: tokens.map((t) => ({
              OR: [
                { displayName: { contains: t, mode: 'insensitive' as const } },
                { searchName: { contains: t, mode: 'insensitive' as const } },
                { managementName: { contains: t, mode: 'insensitive' as const } },
              ],
            })),
          }
        : {}),
    },
    select: { ...LISTING_SELECT, coupangProductItem: { select: { id: true } } },
    orderBy: { displayName: 'asc' },
    take: PAGE_SIZE,
  })

  return NextResponse.json({
    listings: listings.map((l) => ({
      ...summarize(l as LoadedListing),
      linkedItemId: l.coupangProductItem?.id ?? null,
    })),
  })
}
