import { NextRequest, NextResponse } from 'next/server'
import { resolveSpaceContext, assertRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { registerBillingMethod, BillingError } from '@/lib/billing/subscription-service'

export const maxDuration = 60

// GET /api/billing/toss/callback — 토스 카드등록 successUrl.
// 쿼리: authKey, customerKey. 세션 사용자 Space의 customerKey와 일치 검증 후 빌링키 발급.
export async function GET(request: NextRequest) {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const billingUrl = new URL('/settings/billing', request.url)

  const roleError = assertRole(resolved.role, 'OWNER')
  if (roleError) {
    billingUrl.searchParams.set('error', '결제수단 등록은 소유자만 가능합니다')
    return NextResponse.redirect(billingUrl)
  }

  const authKey = request.nextUrl.searchParams.get('authKey')
  const customerKey = request.nextUrl.searchParams.get('customerKey')
  if (!authKey || !customerKey) {
    billingUrl.searchParams.set('error', '카드 등록 정보가 없습니다')
    return NextResponse.redirect(billingUrl)
  }

  // customerKey 위조 방지: 우리 구독 레코드와 일치해야 함 (신규면 등록 과정에서 생성됨)
  const subscription = await prisma.spaceSubscription.findUnique({
    where: { spaceId: resolved.space.id },
    select: { customerKey: true },
  })
  if (subscription?.customerKey && subscription.customerKey !== customerKey) {
    billingUrl.searchParams.set('error', '구매자 식별 정보가 일치하지 않습니다')
    return NextResponse.redirect(billingUrl)
  }

  try {
    await registerBillingMethod(resolved.space.id, authKey)
    billingUrl.searchParams.set('cardRegistered', '1')
  } catch (e) {
    const message = e instanceof BillingError ? e.message : '카드 등록에 실패했습니다'
    billingUrl.searchParams.set('error', message)
  }
  return NextResponse.redirect(billingUrl)
}
