// 일일 스위프 — PUBLISHED 배포에 대해 어제 날짜 COLLECT_METRIC job 을 enqueue.
// D10 "7/14일 인사이트 트리거" 와는 별도 — 이것은 metric 수집 cron.
// 워커 상주 프로세스가 하루 1회 이 함수를 호출하도록 예정.

import { prisma } from '@/lib/prisma'
import { enqueueJob } from './jobs'

export async function scheduleDailyMetricCollection(spaceId?: string) {
  const where = spaceId
    ? { spaceId, status: 'PUBLISHED' as const }
    : { status: 'PUBLISHED' as const }

  const deployments = await prisma.contentDeployment.findMany({
    where,
    select: { id: true, spaceId: true, channelId: true },
  })

  for (const d of deployments) {
    const channel = await prisma.salesContentChannel.findUnique({
      where: { id: d.channelId },
      select: { collectorMode: true },
    })
    if (!channel || channel.collectorMode === 'NONE' || channel.collectorMode === 'MANUAL') {
      continue
    }
    await enqueueJob({
      spaceId: d.spaceId,
      kind: 'COLLECT_METRIC',
      targetId: d.id,
      payload: { deploymentId: d.id },
    })
  }
}
