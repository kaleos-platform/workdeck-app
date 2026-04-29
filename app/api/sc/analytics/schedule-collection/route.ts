// POST /api/sc/analytics/schedule-collection
// → 현재 Space 의 PUBLISHED 배포 중 collectorMode=API|BROWSER 에 대해 COLLECT_METRIC job enqueue.
// 일일 cron 은 워커가 이 엔드포인트를 호출하거나 직접 scheduleDailyMetricCollection 을 호출.

import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { scheduleDailyMetricCollection } from '@/lib/sc/collector-scheduler'

export async function POST() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  await scheduleDailyMetricCollection(resolved.space.id)
  return NextResponse.json({ ok: true })
}
