import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { loadAtomicWords } from '@/lib/sh/keyword-atomic-query'
import {
  suggestKeywords,
  type ProductContext,
  type SuggestPoolItem,
} from '@/lib/sh/keyword-suggest'
import { loadKeywordRules, serializeKeywordRules } from '@/lib/sh/keyword-rules-query'
import { productDisplayName } from '@/lib/sh/product-display'

/** Prisma Json? 필드를 방어적으로 string[] 로 좁힌다 — 타입 캐스팅으로 신뢰하지 않는다. */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

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
  // 화면이 편집 중인 채널 검색용 상품명. 없으면 기존 폴백을 그대로 탄다.
  // 이걸 안 받으면 추천은 공식 상품명 기준으로 거르고 편집기는 채널 검색명 기준으로 검증해서,
  // 추천 칩을 누르는 순간 경고가 뜨는 모순이 생긴다(§10 복합어 판정 이후 특히 눈에 띈다).
  const searchNameParam = searchParams.get('searchName')?.trim() || null
  if (!listingId && !productId) {
    return errorResponse('listingId 또는 productId 가 필요합니다', 400)
  }

  let productName = ''
  let existing: string[] = []
  let channelId: string | null = null
  let productContext: ProductContext | undefined
  // 이 화면이 다루는 상품들. 추천 풀에서 "다른 상품 전용 키워드" 를 걸러내는 데 쓴다.
  let scopeProductIds: string[] = []

  if (listingId) {
    const listing = await prisma.productListing.findFirst({
      where: { id: listingId, spaceId: resolved.space.id },
      select: {
        id: true,
        searchName: true,
        keywords: true,
        channelId: true,
        // listing 은 InvProduct 를 직접 참조하지 않고 items(옵션 구성)을 거친다 —
        // 세트 구성일 수 있으니 연결된 상품들의 문맥을 모두 모은다.
        items: {
          select: {
            option: {
              select: {
                product: {
                  select: {
                    id: true,
                    description: true,
                    features: true,
                    certifications: true,
                  },
                },
              },
            },
          },
        },
      },
    })
    if (!listing) return errorResponse('판매채널 상품을 찾을 수 없습니다', 404)
    productName = listing.searchName
    existing = Array.isArray(listing.keywords) ? (listing.keywords as string[]) : []
    channelId = listing.channelId

    const descriptions: string[] = []
    const features: string[] = []
    const certifications: string[] = []
    for (const linkedItem of listing.items) {
      const p = linkedItem.option?.product
      if (!p) continue
      scopeProductIds.push(p.id)
      if (p.description) descriptions.push(p.description)
      features.push(...toStringArray(p.features))
      certifications.push(...toStringArray(p.certifications))
    }
    if (descriptions.length || features.length || certifications.length) {
      productContext = { description: descriptions.join(' '), features, certifications }
    }
  } else if (productId) {
    const product = await prisma.invProduct.findFirst({
      where: { id: productId, spaceId: resolved.space.id },
      select: {
        id: true,
        name: true,
        internalName: true,
        description: true,
        features: true,
        certifications: true,
      },
    })
    if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)
    scopeProductIds = [product.id]
    productName = searchNameParam || product.name || productDisplayName(product)
    // 상품 단위에는 keywords 컬럼이 없다 — 이미 연결된 키워드를 '등록됨'으로 본다.
    const linked = await prisma.keywordMasterLink.findMany({
      where: { productId, keyword: { spaceId: resolved.space.id } },
      select: { keyword: { select: { keyword: true } } },
    })
    existing = linked.map((l) => l.keyword.keyword)
    productContext = {
      description: product.description,
      features: toStringArray(product.features),
      certifications: toStringArray(product.certifications),
    }
  }

  const rules = await loadKeywordRules(resolved.space.id, channelId)

  // BANNED/EXCLUDED 는 suggestKeywords 가 걸러내지만, 풀을 미리 줄여 전송·정렬 비용을 낮춘다.
  //
  // **다른 상품 전용 키워드는 제외한다.** 마스터는 space 단위 풀이라 그대로 쓰면 브라 상품에서
  // 등록한 '50대여성브라' 가 선 클렌징 패드에도 추천된다. 상품에 연결된 이력이 있는 키워드는
  // 그 상품의 것으로 보고, 어디에도 안 붙은 범용 키워드만 공용으로 쓴다.
  const scope = [...new Set(scopeProductIds)]
  const pool = await prisma.keywordMaster.findMany({
    where: {
      spaceId: resolved.space.id,
      status: { notIn: ['BANNED', 'EXCLUDED'] },
      ...(scope.length > 0
        ? {
            OR: [
              // 어떤 상품에도 연결되지 않은 범용 키워드
              { links: { none: { productId: { not: null } } } },
              // 이 화면의 상품에 연결된 키워드
              { links: { some: { productId: { in: scope } } } },
            ],
          }
        : {}),
    },
    select: { keyword: true, type: true, score: true, status: true },
    orderBy: { score: 'desc' },
    take: 500,
  })

  // 브랜드명은 상품명 단어로 치지 않는다 — 자사 브랜드 검색은 정당한 유입이다.
  const brands = await prisma.brand.findMany({
    where: { spaceId: resolved.space.id },
    select: { name: true },
  })

  const suggestions = suggestKeywords({
    productName,
    existing,
    masterPool: pool as SuggestPoolItem[],
    rules,
    productContext,
    brandNames: brands.map((b) => b.name),
    atomicWords: await loadAtomicWords(resolved.space.id),
  })

  const contextUsed = Boolean(
    productContext &&
    (productContext.description ||
      (productContext.features?.length ?? 0) > 0 ||
      (productContext.certifications?.length ?? 0) > 0)
  )

  return NextResponse.json({
    suggestions,
    productName,
    existingCount: existing.length,
    rules: serializeKeywordRules(rules),
    contextUsed,
  })
}
