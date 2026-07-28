import { NextRequest, NextResponse } from 'next/server'
import { runDueCharges } from '@/lib/billing/subscription-service'

export const runtime = 'nodejs'
// 토스 승인 최대 60초 × 구독 여러 건 — 여유 확보
export const maxDuration = 300

/**
 * GET /api/cron/billing-charge — Vercel cron 호출 전용 (매일 1회).
 *
 * currentPeriodEnd 도래 구독 합산 정기결제 + dunning(+1·+3·+5일 재시도, 3회 실패 EXPIRED).
 * 중복 결제 방지: BillingCharge.orderId(sub_{subId}_{yearMonth}) 유니크 멱등 게이트 —
 * 같은 날 재실행돼도 결제는 주기당 정확히 1회.
 *
 * Vercel cron 인증: `Authorization: Bearer ${CRON_SECRET}` 헤더 필수.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET 미설정' }, { status: 401 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const results = await runDueCharges()
  const counts = results.reduce<Record<string, number>>((acc, r) => {
    const key = r.outcome.startsWith('error') ? 'error' : r.outcome
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  console.log('[billing-cron]', JSON.stringify({ total: results.length, counts }))

  return NextResponse.json({ total: results.length, counts, results })
}
