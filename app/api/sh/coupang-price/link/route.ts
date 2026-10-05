import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { linkCoupangItem } from '@/lib/sh/coupang-price/link-item'

const linkBodySchema = z.object({
  listingId: z.string().min(1),
  coupangProductItemId: z.string().min(1),
})
const unlinkBodySchema = z.object({ coupangProductItemId: z.string().min(1) })

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const parsed = linkBodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const r = await linkCoupangItem(resolved.space.id, parsed.data.coupangProductItemId, parsed.data.listingId)
  if (!r.ok) return errorResponse(r.reason, r.status)
  return NextResponse.json({ ok: true })
}

// 연결 해제 — 잘못 확정한 매칭을 되돌리는 유일한 경로(v1.1 §7.2).
export async function DELETE(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const parsed = unlinkBodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return errorResponse('coupangProductItemId 가 필요합니다', 400)
  const r = await prisma.coupangProductItem.updateMany({
    where: { id: parsed.data.coupangProductItemId, spaceId: resolved.space.id },
    data: { listingId: null },
  })
  if (r.count === 0) return errorResponse('쿠팡 옵션을 찾을 수 없습니다', 404)
  return NextResponse.json({ ok: true })
}
