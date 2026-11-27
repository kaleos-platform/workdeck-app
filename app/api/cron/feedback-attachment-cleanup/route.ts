import { withCronRun } from '@/lib/cron/with-cron-run'
import { runFeedbackCleanup } from '@/lib/feedback/cleanup'

export const runtime = 'nodejs'

export const GET = withCronRun(
  '/api/cron/feedback-attachment-cleanup',
  async () => runFeedbackCleanup(new Date()),
  'cron-secret',
  (detail) => detail.expiredFailed === 0 && detail.ledgerFailed === 0
)
