import { checkCredentialHealth } from '@/lib/agent/integrations/credential-health'
import { withCronRun } from '@/lib/cron/with-cron-run'

export const runtime = 'nodejs'
// Space 수 × 외부 API(최대 15초) — 제한된 병렬로 돌지만 여유를 둔다.
export const maxDuration = 300

/**
 * GET /api/cron/credential-health — Vercel cron 호출 전용(매일).
 * 모든 Space 의 Meta·Google 자격증명이 살아 있는지 점검하고, 상태가 바뀌면 Space 알림 채널에 알린다.
 * 결과(detail)에 복호화한 자격증명 id 를 남긴다(감사).
 */
export const GET = withCronRun('/api/cron/credential-health', async () => checkCredentialHealth())
