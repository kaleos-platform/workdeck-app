// Phase 2 Unit 15 — INSIGHT_SWEEP 스케줄러.
// 주기 cron (예: 매주 월요일 06:00 KST) 으로 호출되어 활성 Space 마다 1건의
// INSIGHT_SWEEP job 을 enqueue 한다. 워커 poller 가 claim → runInsightGeneration.
//
// collector-scheduler.ts 와 동일한 서버-측 라이브러리 패턴.

import { prisma } from '@/lib/prisma'
import { enqueueJob } from './jobs'

type ScheduleInput = {
  spaceId?: string // 단일 공간 수동 트리거용 (옵션)
  sinceDays?: number // 분석 대상 최근 N일 (기본 30)
  maxProposals?: number // 제안 상한 (기본 5)
  skipIfRecentHours?: number // 최근 N시간 내 PENDING/RUNNING 스윕이 있으면 스킵 (기본 12)
}

export async function scheduleInsightSweep(input: ScheduleInput = {}) {
  const skipIfRecentHours = input.skipIfRecentHours ?? 12
  const payload = {
    sinceDays: input.sinceDays ?? 30,
    maxProposals: input.maxProposals ?? 5,
  }

  // 대상 Space 선정
  //   - 단일 Space 지정: 그 공간만
  //   - 전체: 최근 sinceDays 내 PUBLISHED 배포가 1건이라도 있는 공간
  let targetSpaceIds: string[] = []
  if (input.spaceId) {
    targetSpaceIds = [input.spaceId]
  } else {
    const since = new Date(Date.now() - payload.sinceDays * 24 * 60 * 60 * 1000)
    const spaces = await prisma.contentDeployment.findMany({
      where: { status: 'PUBLISHED', publishedAt: { gte: since } },
      select: { spaceId: true },
      distinct: ['spaceId'],
    })
    targetSpaceIds = spaces.map((s) => s.spaceId)
  }

  const enqueued: string[] = []
  const skipped: Array<{ spaceId: string; reason: string }> = []

  for (const spaceId of targetSpaceIds) {
    // 최근 N시간 내 동일 job 이 있으면 중복 방지
    const recentCutoff = new Date(Date.now() - skipIfRecentHours * 60 * 60 * 1000)
    const recent = await prisma.salesContentJob.findFirst({
      where: {
        spaceId,
        kind: 'INSIGHT_SWEEP',
        status: { in: ['PENDING', 'CLAIMED'] },
        createdAt: { gte: recentCutoff },
      },
      select: { id: true },
    })
    if (recent) {
      skipped.push({ spaceId, reason: 'recent_pending' })
      continue
    }

    const job = await enqueueJob({
      spaceId,
      kind: 'INSIGHT_SWEEP',
      targetId: spaceId, // worker 가 spaceId 추출 시 fallback 키로 사용
      payload,
    })
    enqueued.push(job.id)
  }

  return { enqueued, skipped, total: targetSpaceIds.length }
}
