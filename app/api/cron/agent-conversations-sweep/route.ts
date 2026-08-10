import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'

export const runtime = 'nodejs'

/**
 * GET /api/cron/agent-conversations-sweep — Vercel cron 호출 전용.
 *
 * 7일 이상 갱신되지 않은 대화 세션(AgentConversation)을 삭제한다(TTL).
 * Slack 스레드는 오래되면 사실상 죽으므로 히스토리를 무한 보관하지 않는다.
 *
 * Vercel cron 인증(`Authorization: Bearer ${CRON_SECRET}`)과 실행 이력 기록은
 * `withCronRun`이 담당한다.
 */
export const GET = withCronRun('/api/cron/agent-conversations-sweep', async () => {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const { count } = await prisma.agentConversation.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  })
  return { deleted: count }
})
