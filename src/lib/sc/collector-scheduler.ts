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
    select: {
      id: true,
      spaceId: true,
      channel: { select: { collectorMode: true } },
    },
  })

  // 중복 enqueue 방지: 같은 배포에 PENDING/CLAIMED COLLECT_METRIC 잡이 이미 있으면 스킵.
  const deploymentIds = deployments.map((d) => d.id)
  const existingJobs = await prisma.salesContentJob.findMany({
    where: {
      kind: 'COLLECT_METRIC',
      status: { in: ['PENDING', 'CLAIMED'] },
      targetId: { in: deploymentIds },
    },
    select: { targetId: true },
  })
  const enqueuedIds = new Set(existingJobs.map((j) => j.targetId).filter(Boolean) as string[])

  for (const d of deployments) {
    if (!d.channel || d.channel.collectorMode === 'NONE' || d.channel.collectorMode === 'MANUAL') {
      continue
    }
    if (enqueuedIds.has(d.id)) {
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
