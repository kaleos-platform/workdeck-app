import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { loadAdTermsForProduct } from '@/lib/sh/ad-terms-query'

/**
 * 광고 검색어 후보 — `?productId=`.
 *
 * 집계 본문은 `src/lib/sh/ad-terms-query.ts` 의 `loadAdTermsForProduct` 에 있다(AI 초안
 * 라우트가 같은 데이터를 프롬프트 근거로 재사용한다). 스코프 경로와 "매핑 없으면 조용히
 * 빈 배열" 규약은 그 파일 상단 주석 참조.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const productId = req.nextUrl.searchParams.get('productId')?.trim() || null
  if (!productId) return errorResponse('productId 가 필요합니다', 400)

  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 50)))

  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  return NextResponse.json(await loadAdTermsForProduct(resolved.space.id, productId, limit))
}
