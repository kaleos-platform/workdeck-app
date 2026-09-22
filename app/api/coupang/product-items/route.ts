/**
 * POST /api/coupang/product-items — 워커가 수집한 쿠팡 상품 API 결과를 적재한다.
 * 워커 전용(x-worker-api-key). listingId 는 여기서 절대 건드리지 않는다(product-items.ts).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkerAuth } from '@/lib/api-helpers'
import { upsertCoupangProductItems } from '@/lib/coupang/product-items'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const body = (await request.json()) as {
    spaceId?: string
    rows?: Parameters<typeof upsertCoupangProductItems>[1]
  }
  if (!body.spaceId || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: 'spaceId 와 rows 가 필요합니다' }, { status: 400 })
  }
  const upserted = await upsertCoupangProductItems(body.spaceId, body.rows)
  return NextResponse.json({ upserted })
}
