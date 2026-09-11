import { NextRequest, NextResponse } from 'next/server'
import { resolveSpaceContext, assertRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { registerBillingMethod, BillingError } from '@/lib/billing/subscription-service'
import { sanitizeRedirectPath } from '@/lib/auth-redirect'
import { SETTINGS_PAYMENTS_PATH } from '@/lib/deck-routes'

export const maxDuration = 60

// GET /api/billing/toss/callback — 토스 카드등록 successUrl.
// 쿼리: authKey, customerKey. 세션 사용자 Space의 customerKey와 일치 검증 후 빌링키 발급.
export async function GET(request: NextRequest) {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // returnTo: 카드 등록을 시작한 화면으로 되돌린다 (구독 확인 모달을 이어서 열기 위함).
  // 외부 URL 이 들어오면 오픈 리다이렉트가 되므로 내부 경로만 허용한다.
  const returnTo =
    sanitizeRedirectPath(request.nextUrl.searchParams.get('returnTo')) ?? SETTINGS_PAYMENTS_PATH
  const billingUrl = new URL(returnTo, request.url)

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
