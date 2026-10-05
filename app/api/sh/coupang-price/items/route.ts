// GET /api/sh/coupang-price/items?search=
// 지연 매핑 피커 후보 조회 — space 의 CoupangProductItem 중 listingId 가 비어 있는 것.
// 검색은 tokenizeProductName AND 매칭(itemName 기준) — 피커의 키워드 칩과 동일 규칙.
import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { tokenizeProductName } from '@/lib/inv/search-tokens'

const PAGE_SIZE = 50

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const search = (req.nextUrl.searchParams.get('search') ?? '').trim()
  const tokens = search ? tokenizeProductName(search) : []

  const items = await prisma.coupangProductItem.findMany({
    where: {
      spaceId: resolved.space.id,
      listingId: null,
      ...(tokens.length > 0
        ? { AND: tokens.map((t) => ({ itemName: { contains: t, mode: 'insensitive' as const } })) }
        : {}),
    },
    select: {
      id: true,
      itemName: true,
      sellerProductId: true,
      rgVendorItemId: true,
      mpVendorItemId: true,
      barcode: true,
    },
    orderBy: { collectedAt: 'desc' },
    take: PAGE_SIZE,
  })

  return NextResponse.json({ items, total: items.length })
}
