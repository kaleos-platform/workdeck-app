import { NextResponse } from 'next/server'
import { resolveSpaceContext, assertRole, errorResponse } from '@/lib/api-helpers'
import { ensureCustomerKey } from '@/lib/billing/subscription-service'

// POST /api/billing/setup — 카드 등록 SDK 호출 전 customerKey 선발급 (OWNER 전용)
export async function POST() {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved.error
  const roleError = assertRole(resolved.role, 'OWNER')
  if (roleError) return roleError

  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY
  if (!clientKey) return errorResponse('결제 설정이 완료되지 않았습니다', 503)

  const customerKey = await ensureCustomerKey(resolved.space.id)
  return NextResponse.json({ customerKey, clientKey })
}
