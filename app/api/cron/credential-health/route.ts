import { checkCredentialHealth } from '@/lib/agent/integrations/credential-health'
import { withCronRun } from '@/lib/cron/with-cron-run'

export const runtime = 'nodejs'

/**
 * GET /api/cron/credential-health — Vercel cron 호출 전용(매일).
 * 모든 Space 의 Meta·Google 자격증명이 살아 있는지 점검하고, 상태가 바뀌면 Space 알림 채널에 알린다.
 */
export const GET = withCronRun('/api/cron/credential-health', async () => checkCredentialHealth())
