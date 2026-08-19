import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { suggestKeywords, type SuggestPoolItem } from '@/lib/sh/keyword-suggest'
import { loadKeywordRules, serializeKeywordRules } from '@/lib/sh/keyword-rules-query'
import { productDisplayName } from '@/lib/sh/product-display'

/**
 * 검색어 추천 — `?listingId=` 또는 `?productId=`.
 * 순수 함수(suggestKeywords)에 이 space 의 키워드 마스터 풀을 주입해 호출한다.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const listingId = searchParams.get('listingId')?.trim() || null
  const productId = searchParams.get('productId')?.trim() || null
  if (!listingId && !productId) {
    return errorResponse('listingId 또는 productId 가 필요합니다', 400)
  }

  let productName = ''
  let existing: string[] = []
  let channelId: string | null = null

  if (listingId) {
    const listing = await prisma.productListing.findFirst({
      where: { id: listingId, spaceId: resolved.space.id },
      select: { id: true, searchName: true, keywords: true, channelId: true },
    })
    if (!listing) return errorResponse('판매채널 상품을 찾을 수 없습니다', 404)
    productName = listing.searchName
    existing = Array.isArray(listing.keywords) ? (listing.keywords as string[]) : []
    channelId = listing.channelId
  } else if (productId) {
    const product = await prisma.invProduct.findFirst({
      where: { id: productId, spaceId: resolved.space.id },
      select: { id: true, name: true, internalName: true },
    })
    if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)
    productName = product.name || productDisplayName(product)
    // 상품 단위에는 keywords 컬럼이 없다 — 이미 연결된 키워드를 '등록됨'으로 본다.
    const linked = await prisma.keywordMasterLink.findMany({
      where: { productId, keyword: { spaceId: resolved.space.id } },
      select: { keyword: { select: { keyword: true } } },
    })
    existing = linked.map((l) => l.keyword.keyword)
  }

  const rules = await loadKeywordRules(resolved.space.id, channelId)

  // BANNED/EXCLUDED 는 suggestKeywords 가 걸러내지만, 풀을 미리 줄여 전송·정렬 비용을 낮춘다.
  const pool = await prisma.keywordMaster.findMany({
    where: { spaceId: resolved.space.id, status: { notIn: ['BANNED', 'EXCLUDED'] } },
    select: { keyword: true, type: true, score: true, status: true },
    orderBy: { score: 'desc' },
    take: 500,
  })

  const suggestions = suggestKeywords({
    productName,
    existing,
    masterPool: pool as SuggestPoolItem[],
    rules,
  })

  return NextResponse.json({
    suggestions,
    productName,
    existingCount: existing.length,
    rules: serializeKeywordRules(rules),
  })
}
