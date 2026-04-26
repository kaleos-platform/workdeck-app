import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productListingBulkPatchSchema } from '@/lib/sh/schemas'

/**
 * 여러 Listing 일괄 수정 — 현재는 retailPrice(판매가)와 status만 지원.
 * 그룹 상세 화면의 bulk edit 바에서 호출.
 */
export async function PATCH(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const parsed = productListingBulkPatchSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const { ids, patch } = parsed.data

  // Space 소속 검증
  const existing = await prisma.productListing.findMany({
    where: { id: { in: ids }, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (existing.length !== ids.length) {
    return errorResponse('일부 listing을 찾을 수 없습니다', 400)
  }

  const data: { retailPrice?: number | null; status?: 'ACTIVE' | 'SUSPENDED' } = {}
  if (patch.retailPrice !== undefined) data.retailPrice = patch.retailPrice
  if (patch.status !== undefined) data.status = patch.status

  const result = await prisma.productListing.updateMany({
    where: { id: { in: ids }, spaceId: resolved.space.id },
    data,
  })

  return NextResponse.json({ updated: result.count })
}
