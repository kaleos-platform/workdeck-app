import { runDueCharges } from '@/lib/billing/subscription-service'
import { withCronRun } from '@/lib/cron/with-cron-run'

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
 * Vercel cron 인증(`Authorization: Bearer ${CRON_SECRET}`)과 실행 이력 기록은
 * `withCronRun`이 담당한다.
 */
export const GET = withCronRun('/api/cron/billing-charge', async () => {
  const results = await runDueCharges()
  const counts = results.reduce<Record<string, number>>((acc, r) => {
    const key = r.outcome.startsWith('error') ? 'error' : r.outcome
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  console.log('[billing-cron]', JSON.stringify({ total: results.length, counts }))

  return { total: results.length, counts, results }
})
