import { NextRequest, NextResponse } from 'next/server'
import { resolveSpaceContext, assertRole, errorResponse } from '@/lib/api-helpers'
import { removeBillingMethod, BillingError } from '@/lib/billing/subscription-service'

// DELETE /api/billing/methods — 등록된 결제수단 삭제 (OWNER 전용).
// 빌링키는 결제를 실행할 수 있는 자격증명이므로 DB 행만 지우지 않고 PG 쪽에서도 폐기한다.
export async function DELETE(request: NextRequest) {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved.error
  const roleError = assertRole(resolved.role, 'OWNER')
  if (roleError) return roleError

  const body = (await request.json().catch(() => null)) as { methodId?: unknown } | null
  const methodId = typeof body?.methodId === 'string' ? body.methodId : null

  try {
    await removeBillingMethod(resolved.space.id, methodId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof BillingError) return errorResponse(e.message, e.status)
    console.error('[billing] removeBillingMethod 실패', e)
    return errorResponse('결제수단 삭제에 실패했습니다', 500)
  }
}
