import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { assertRole, resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { linkCoupangItem } from '@/lib/sh/coupang-price/link-item'

const bodySchema = z.object({
  pairs: z
    .array(z.object({ coupangProductItemId: z.string().min(1), listingId: z.string().min(1) }))
    .min(1)
    .max(500),
})

/** 후보 일괄 확정 — 한 건 충돌이 나머지를 막지 않는다(건별 결과 반환). */
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  // 매칭은 쿠팡의 어느 옵션에 돈(가격)이 쓰일지를 정한다 — 반영 API 와 같은 ADMIN.
  const denied = assertRole(resolved.role, 'ADMIN')
  if (denied) return denied
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  let confirmed = 0
  const skipped: Array<{ coupangProductItemId: string; reason: string }> = []
  for (const p of parsed.data.pairs) {
    const r = await linkCoupangItem(resolved.space.id, p.coupangProductItemId, p.listingId)
    if (r.ok) confirmed += 1
    else skipped.push({ coupangProductItemId: p.coupangProductItemId, reason: r.reason })
  }
  return NextResponse.json({ confirmed, skipped })
}
