import { withCronRun } from '@/lib/cron/with-cron-run'
import { runPlatformFunnelReport } from '@/lib/admin/platform-funnel-report'

export const runtime = 'nodejs'

/**
 * GET /api/cron/platform-funnel-report — Vercel cron(매주 월 00:00 UTC = 09:00 KST).
 * 운영사 홈페이지 GA4 의 최근 7일 퍼널 요약을 운영 Slack 채널로 보낸다.
 * 발송이 실패(채널 없음·전부 실패)하면 실행 이력에 실패로 남는다.
 */
export const GET = withCronRun(
  '/api/cron/platform-funnel-report',
  async () => runPlatformFunnelReport(),
  'cron-secret',
  (detail) => detail.sent === true
)
