import { withCronRun } from '@/lib/cron/with-cron-run'
import { runDailyDigest } from '@/lib/hiring/mail'

export const runtime = 'nodejs'

/**
 * GET /api/cron/hiring-daily-digest — Vercel cron(매일 00:00 UTC = 09:00 KST).
 * 「새 지원자 일일 요약 메일」을 켠 공고의 전날 새 지원자 수를 담당자에게 보낸다.
 * 중복 방지는 HiringDailyDigestLog (수신자, 집계일) unique.
 */
export const GET = withCronRun(
  '/api/cron/hiring-daily-digest',
  async () => runDailyDigest(),
  'cron-secret',
  (detail) => detail.failed === 0
)
