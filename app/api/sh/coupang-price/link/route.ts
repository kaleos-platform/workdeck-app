import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const linkBodySchema = z.object({
  listingId: z.string().min(1),
  coupangProductItemId: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const parsed = linkBodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const { listingId, coupangProductItemId } = parsed.data

  const listing = await prisma.productListing.findFirst({
    where: { id: listingId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!listing) return errorResponse('판매채널 상품을 찾을 수 없습니다', 404)

  const item = await prisma.coupangProductItem.findFirst({
    where: { id: coupangProductItemId, spaceId: resolved.space.id },
    select: { id: true, listingId: true },
  })
  if (!item) return errorResponse('쿠팡 옵션을 찾을 수 없습니다', 404)

  // 이미 다른 리스팅에 연결된 항목이면 거부 — 사람이 이전에 확정한 매핑을
  // 조용히 재연결하면 그 확정이 사라진다. 재연결하려면 먼저 해제해야 한다.
  if (item.listingId && item.listingId !== listingId) {
    return errorResponse('이미 다른 판매채널 상품에 연결된 쿠팡 옵션입니다', 400)
  }

  // 대상 리스팅에 이미 다른 쿠팡 옵션이 연결되어 있으면 마찬가지로 거부한다 —
  // listingId는 @unique라 재연결 시 기존 연결이 조용히 끊어지고, 그 연결도
  // 누군가 사람이 확정한 값일 수 있다. 양방향 모두 명시적 해제를 먼저 요구한다.
  const conflicting = await prisma.coupangProductItem.findFirst({
    where: { listingId, spaceId: resolved.space.id, NOT: { id: coupangProductItemId } },
    select: { id: true },
  })
  if (conflicting) {
    return errorResponse('이미 다른 쿠팡 옵션이 연결된 판매채널 상품입니다', 400)
  }

  await prisma.coupangProductItem.update({
    where: { id: coupangProductItemId },
    data: { listingId },
  })

  return NextResponse.json({ ok: true })
}
