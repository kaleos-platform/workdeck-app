import { withCronRun } from '@/lib/cron/with-cron-run'
import { collectNaverRanks } from '@/lib/rank/collect-naver'
import { getRankSlotLimit } from '@/lib/rank/slots'

export const runtime = 'nodejs'

// 04~06시 KST 에 여러 번 돌려 시간 제한(50초)으로 끊긴 수집을 이어받는다.
const DEADLINE_MS = 50_000
const DAILY_BUDGET_DEFAULT = 20_000

export const GET = withCronRun('/api/cron/keyword-rank-naver', async () => {
  const clientId = process.env.NAVER_CLIENT_ID
  const clientSecret = process.env.NAVER_CLIENT_SECRET
  if (!clientId || !clientSecret) return { skipped: 'NO_API_KEY' }

  const budget = Number(process.env.NAVER_SEARCH_DAILY_BUDGET)
  const summary = await collectNaverRanks({
    deadlineMs: Date.now() + DEADLINE_MS,
    dailyBudget: Number.isInteger(budget) && budget > 0 ? budget : DAILY_BUDGET_DEFAULT,
    slotLimit: getRankSlotLimit(),
    clientId,
    clientSecret,
  })
  return { ...summary }
})
