import { withCronRun } from '@/lib/cron/with-cron-run'
import { runSentryAutofixDigest } from '@/lib/sentry/autofix-digest'

export const runtime = 'nodejs'

/**
 * GET /api/cron/sentry-autofix-digest — Vercel cron(매일 22:30 UTC = 07:30 KST).
 * Sentry 노트를 읽어 승인 대기·확인 필요 오류를 운영 Slack 채널로 보낸다.
 * 보낼 게 없거나 Sentry 미설정이면 skipped.
 */
export const GET = withCronRun(
  '/api/cron/sentry-autofix-digest',
  async () => runSentryAutofixDigest(),
  'cron-secret',
  (detail) => detail.sent === true || detail.skipped === true
)
