import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBillingProvider } from '@/lib/billing/providers/toss'

export const runtime = 'nodejs'
export const maxDuration = 60

// 청구 내역에 명시된 업무만 취소 범위로 인정한다.
function chargedDeckIds(breakdown: unknown): string[] {
  if (!Array.isArray(breakdown)) return []
  return [
    ...new Set(
      breakdown.flatMap((line: unknown) => {
        if (!line || typeof line !== 'object') return []
        const value = line as Record<string, unknown>
        return value.type === 'DECK' && typeof value.deckAppId === 'string' ? [value.deckAppId] : []
      })
    ),
  ]
}

/**
 * POST /api/billing/toss/webhook — 토스 결제 상태 변경 수신.
 *
 * 위조 방지 2중:
 * 1) 웹훅 URL 시크릿(?secret=) — 토스 대시보드 등록 URL에 포함, TOSS_WEBHOOK_SECRET 비교
 * 2) 페이로드 상태를 신뢰하지 않고 paymentKey로 원 결제를 API 재조회해 확정
 *
 * 멱등: 전액 환불 이력과 구독 종료를 같은 transaction에서 반영한다.
 * 취소/환불 상태만 반영한다. 승인(PAID)은 동기 승인 경로가 진실 — 웹훅으로 승격하지 않음.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.TOSS_WEBHOOK_SECRET
  if (!secret || request.nextUrl.searchParams.get('secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ ok: true }) // 파싱 불가 페이로드는 무시(재전송 방지 200)

  const provider = getBillingProvider()
  const parsed = provider.parseWebhook(body)
  if (!parsed.paymentKey || !parsed.orderId) return NextResponse.json({ ok: true })

  const charge = await prisma.billingCharge.findUnique({ where: { orderId: parsed.orderId } })
  if (!charge) return NextResponse.json({ ok: true }) // 우리 주문 아님

  // 페이로드 불신 — 원 결제 재조회로 실제 상태 확정
  let actual: { orderId: string; status: string }
  try {
    actual = await provider.fetchPaymentStatus(parsed.paymentKey)
  } catch {
    return NextResponse.json({ error: 'verify failed' }, { status: 502 })
  }
  if (actual.orderId !== charge.orderId) return NextResponse.json({ ok: true })

  // 부분 취소는 남은 결제액이 있으므로 전액 환불·구독 종료로 취급하지 않는다.
  if (actual.status !== 'CANCELED') return NextResponse.json({ ok: true })
  if (
    charge.provider !== provider.id ||
    (charge.paymentKey && charge.paymentKey !== parsed.paymentKey)
  )
    return NextResponse.json({ ok: true })

  try {
    await prisma.$transaction(async (tx) => {
      // 신규 청구 준비·관리자 정책 변경과 같은 Space 행을 잠근다.
      await tx.$queryRaw`SELECT id FROM "Space" WHERE id = ${charge.spaceId} FOR UPDATE`
      const current = await tx.billingCharge.findUnique({ where: { id: charge.id } })
      if (!current || !['PAID', 'REFUNDED'].includes(current.status))
        throw new Error('CHARGE_NOT_SETTLED')

      await tx.billingCharge.updateMany({
        where: { id: current.id, status: 'PAID' },
        data: { status: 'REFUNDED' },
      })
      const subscription = await tx.spaceSubscription.findUnique({
        where: { spaceId: current.spaceId },
      })
      // 지연된 과거 환불 웹훅으로 새 결제 주기의 권한을 제거하지 않는다.
      if (
        !subscription?.currentPeriodEnd ||
        subscription.currentPeriodEnd.getTime() !== current.periodEnd.getTime()
      )
        return
      const deckIds = chargedDeckIds(current.breakdown)
      if (deckIds.length === 0) return
      const otherCharges = await tx.billingCharge.findMany({
        where: {
          spaceId: current.spaceId,
          id: { not: current.id },
          status: { in: ['PAID', 'PENDING'] },
          periodEnd: { gte: current.periodEnd },
        },
        select: { breakdown: true, status: true },
      })
      // 처리 중인 결제가 실패할 수 있으므로 권한 보장으로 간주하지 않고 재전송을 요청한다.
      if (otherCharges.some((other) => other.status === 'PENDING'))
        throw new Error('CHARGE_IN_PROGRESS')
      const covered = new Set(
        otherCharges
          .filter((other) => other.status === 'PAID')
          .flatMap((other) => chargedDeckIds(other.breakdown))
      )
      const ending = deckIds.filter((id) => !covered.has(id))
      if (ending.length === 0) return
      await tx.subscriptionItem.updateMany({
        where: {
          subscriptionId: subscription.id,
          type: 'DECK',
          deckAppId: { in: ending },
          status: { in: ['ACTIVE', 'CANCEL_AT_PERIOD_END'] },
        },
        data: { status: 'ENDED', endedAt: new Date(), lockedPrice: null },
      })
      const remaining = await tx.subscriptionItem.count({
        where: {
          subscriptionId: subscription.id,
          status: { in: ['ACTIVE', 'CANCEL_AT_PERIOD_END'] },
        },
      })
      if (remaining === 0)
        await tx.spaceSubscription.update({
          where: { id: subscription.id },
          data: { status: 'CANCELED', currentPeriodEnd: null, retryCount: 0 },
        })
    })
  } catch {
    return NextResponse.json({ error: 'refund sync failed' }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
