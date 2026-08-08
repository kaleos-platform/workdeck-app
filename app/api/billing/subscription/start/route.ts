import { NextRequest, NextResponse } from 'next/server'
import { resolveSpaceContext, assertRole, errorResponse } from '@/lib/api-helpers'
import { startSubscription, BillingError } from '@/lib/billing/subscription-service'

export const maxDuration = 90 // 토스 승인 최대 60초 + 여유

// POST /api/billing/subscription/start — deck 선택 구독 시작 (OWNER 전용)
export async function POST(request: NextRequest) {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved.error
  const roleError = assertRole(resolved.role, 'OWNER')
  if (roleError) return roleError

  const body = (await request.json().catch(() => null)) as { deckIds?: unknown } | null
  const deckIds = Array.isArray(body?.deckIds)
    ? body.deckIds.filter((d): d is string => typeof d === 'string')
    : []
  if (deckIds.length === 0) return errorResponse('구독할 업무를 선택하세요', 400)

  try {
    const result = await startSubscription(resolved.space.id, deckIds)
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof BillingError) return errorResponse(e.message, e.status)
    console.error('[billing] startSubscription 실패', e)
    return errorResponse('구독 시작에 실패했습니다', 500)
  }
}
