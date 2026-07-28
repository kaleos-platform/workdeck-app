import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBillingProvider } from '@/lib/billing/providers/toss'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/billing/toss/webhook — 토스 결제 상태 변경 수신.
 *
 * 위조 방지 2중:
 * 1) 웹훅 URL 시크릿(?secret=) — 토스 대시보드 등록 URL에 포함, TOSS_WEBHOOK_SECRET 비교
 * 2) 페이로드 상태를 신뢰하지 않고 paymentKey로 원 결제를 API 재조회해 확정
 *
 * 멱등: orderId 기준 upsert — 같은 이벤트 중복 수신해도 상태 1회만 반영.
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

  // 취소·환불만 반영 (멱등: 이미 반영된 상태면 no-op)
  if (actual.status === 'CANCELED' || actual.status === 'PARTIAL_CANCELED') {
    await prisma.billingCharge.updateMany({
      where: { id: charge.id, status: { not: 'REFUNDED' } },
      data: { status: 'REFUNDED' },
    })
  }

  return NextResponse.json({ ok: true })
}
