import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { computePriceTargets, priceInputSchema } from '@/lib/sh/coupang-price/compute-targets'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error

  const parsed = priceInputSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const r = await computePriceTargets(resolved.space.id, parsed.data)
  if ('error' in r) return errorResponse(r.error, r.status)
  return NextResponse.json({ targets: r.targets, ambiguous: r.ambiguous, unmatched: r.unmatched })
}
