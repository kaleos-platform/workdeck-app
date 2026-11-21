import { withCronRun } from '@/lib/cron/with-cron-run'
import { listCafe24Channels, runCafe24FullScan } from '@/lib/channel-orders/adapters/cafe24'
import { runReconcile } from '@/lib/channel-orders/reconcile-run'

export const runtime = 'nodejs'

/**
 * GET /api/cron/channel-orders-reconcile — 09·18시 KST. 카페24 일일 전수 조회(앱 서버)를 먼저 하고 대사한다.
 * 네이버·쿠팡 전수 조회는 워커가 대사 시각 전에 FULL_SCAN operation 으로 남긴다(게이트가 없으면 판정 불가).
 */
export const GET = withCronRun('/api/cron/channel-orders-reconcile', async () => {
  const scans = []
  for (const { channelId } of await listCafe24Channels())
    scans.push(await runCafe24FullScan(channelId))
  const reconcile = await runReconcile()
  return { scans, ...reconcile }
})
