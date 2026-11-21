import { withCronRun } from '@/lib/cron/with-cron-run'
import { listCafe24Channels, runCafe24Observe } from '@/lib/channel-orders/adapters/cafe24'

export const runtime = 'nodejs'

/** GET /api/cron/channel-orders-cafe24 — 30분마다 카페24 주문을 읽기 전용으로 관측한다(채널 직렬). */
export const GET = withCronRun('/api/cron/channel-orders-cafe24', async () => {
  const results = []
  for (const { channelId } of await listCafe24Channels()) {
    results.push(await runCafe24Observe(channelId))
  }
  return { channels: results.length, results }
})
