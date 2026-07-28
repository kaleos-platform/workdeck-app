import { NextRequest, NextResponse } from 'next/server'
import { resolveSpaceContext, assertRole, errorResponse } from '@/lib/api-helpers'
import { addDeck, cancelDeck, BillingError } from '@/lib/billing/subscription-service'

export const maxDuration = 90 // 일할 즉시결제 포함

async function resolveOwner() {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved
  const roleError = assertRole(resolved.role, 'OWNER')
  if (roleError) return { error: roleError }
  return resolved
}

function parseDeckAppId(body: unknown): string {
  const b = body as { deckAppId?: unknown } | null
  return typeof b?.deckAppId === 'string' ? b.deckAppId.trim() : ''
}

// POST /api/billing/subscription/decks — deck 중도 추가 (일할 즉시결제)
export async function POST(request: NextRequest) {
  const resolved = await resolveOwner()
  if ('error' in resolved) return resolved.error

  const deckAppId = parseDeckAppId(await request.json().catch(() => null))
  if (!deckAppId) return errorResponse('deckAppId가 필요합니다', 400)

  try {
    const result = await addDeck(resolved.space.id, deckAppId)
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof BillingError) return errorResponse(e.message, e.status)
    console.error('[billing] addDeck 실패', e)
    return errorResponse('deck 추가에 실패했습니다', 500)
  }
}

// DELETE /api/billing/subscription/decks — deck 해제 예약 (기간말까지 사용)
export async function DELETE(request: NextRequest) {
  const resolved = await resolveOwner()
  if ('error' in resolved) return resolved.error

  const deckAppId = parseDeckAppId(await request.json().catch(() => null))
  if (!deckAppId) return errorResponse('deckAppId가 필요합니다', 400)

  try {
    const result = await cancelDeck(resolved.space.id, deckAppId)
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof BillingError) return errorResponse(e.message, e.status)
    console.error('[billing] cancelDeck 실패', e)
    return errorResponse('deck 해제에 실패했습니다', 500)
  }
}
