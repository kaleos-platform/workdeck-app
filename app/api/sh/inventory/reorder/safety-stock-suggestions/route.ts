// GET /api/sh/inventory/reorder/safety-stock-suggestions?optionIds=a,b,c&serviceLevel=0.95
// 옵션별 안전재고 제안 — 확정 계획들의 예측오차 분산 기반 (사람 승인 전용).

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import {
  computeSafetyStockSuggestions,
  SERVICE_LEVEL_Z,
} from '@/lib/inv/forecast/safety-stock-suggestion'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { searchParams } = req.nextUrl

  const optionIdsParam = searchParams.get('optionIds')
  const optionIds = optionIdsParam
    ? optionIdsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined

  const slParam = searchParams.get('serviceLevel')
  const serviceLevel =
    slParam && slParam in SERVICE_LEVEL_Z ? (slParam as keyof typeof SERVICE_LEVEL_Z) : undefined

  const suggestions = await computeSafetyStockSuggestions(spaceId, { optionIds, serviceLevel })

  return NextResponse.json({ suggestions })
}
