import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { assertRole, errorResponse, resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// 여러 개를 한 번에 — 매칭 화면 다중 선택 일괄 처리.
const bodySchema = z.object({
  coupangProductItemIds: z.array(z.string().min(1)).min(1).max(1000),
  excluded: z.boolean(),
})

/**
 * POST /api/sh/coupang-price/matching/exclude — 쿠팡 옵션 "매칭 안 함" 지정/해제.
 * 판매중지·중복 리스팅처럼 가격 반영 대상이 아닌 옵션을 목록과 자동 후보 경쟁에서 뺀다.
 * 제외하면 기존 연결도 끊는다 — 제외된 옵션에 가격이 쓰이면 안 된다.
 */
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error
  // 매칭과 같은 이유로 ADMIN — 어느 쿠팡 옵션에 가격을 쓸지 결정한다.
  const denied = assertRole(resolved.role, 'ADMIN')
  if (denied) return denied

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const { coupangProductItemIds, excluded } = parsed.data

  const r = await prisma.coupangProductItem.updateMany({
    where: { id: { in: coupangProductItemIds }, spaceId: resolved.space.id },
    data: excluded ? { excludedAt: new Date(), listingId: null } : { excludedAt: null },
  })
  if (r.count === 0) return errorResponse('쿠팡 옵션을 찾을 수 없습니다', 404)
  return NextResponse.json({ updated: r.count })
}
