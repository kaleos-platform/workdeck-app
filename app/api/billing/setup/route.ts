import { NextResponse } from 'next/server'
import { resolveSpaceContext, assertRole, errorResponse } from '@/lib/api-helpers'
import {
  assertCheckoutOpen,
  BillingError,
  ensureCustomerKey,
} from '@/lib/billing/subscription-service'
import { CHECKOUT_OPEN_DECKS } from '@/lib/billing/entitlement'

// POST /api/billing/setup — 카드 등록 SDK 호출 전 customerKey 선발급 (OWNER 전용)
export async function POST() {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved.error
  const roleError = assertRole(resolved.role, 'OWNER')
  if (roleError) return roleError

  try {
    // 카드 등록은 업무와 무관 — 결제가 열린 업무가 하나라도 있으면 허용
    assertCheckoutOpen(resolved.space.id, CHECKOUT_OPEN_DECKS)
  } catch (e) {
    if (e instanceof BillingError) return errorResponse(e.message, e.status)
    throw e
  }

  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY
  if (!clientKey) return errorResponse('결제 설정이 완료되지 않았습니다', 503)

  const customerKey = await ensureCustomerKey(resolved.space.id)
  return NextResponse.json({ customerKey, clientKey })
}
