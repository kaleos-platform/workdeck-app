import { expirePendingActions } from '@/lib/agent/actions/execute'
import { withCronRun } from '@/lib/cron/with-cron-run'

export const runtime = 'nodejs'

/**
 * GET /api/cron/agent-actions-expire — Vercel cron 호출 전용.
 *
 * 만료(expiresAt 경과)된 PENDING 승인 액션을 EXPIRED로 전환한다.
 * 목록 조회 시 lazy expire의 보완 — 아무도 큐를 열지 않아도 만료가 진행되도록 매일 돌린다.
 *
 * Vercel cron 인증(`Authorization: Bearer ${CRON_SECRET}`)과 실행 이력 기록은
 * `withCronRun`이 담당한다.
 */
export const GET = withCronRun('/api/cron/agent-actions-expire', async () => {
  const expired = await expirePendingActions()
  return { expired }
})
