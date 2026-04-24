// SalesContentJob 헬퍼 — enqueue / atomic claim / complete.

import { prisma } from '@/lib/prisma'
import type { SalesContentJobKind, SalesContentJob } from '@/generated/prisma/client'

export const MAX_ATTEMPTS = 3
// 재시도 백오프(ms): 1m / 5m / 15m
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000]

export function nextRetryAt(attempts: number, now: Date = new Date()): Date {
  const ms = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]
  return new Date(now.getTime() + ms)
}

export async function enqueueJob(input: {
  spaceId: string
  kind: SalesContentJobKind
  targetId?: string | null
  payload?: unknown
  scheduledAt?: Date
}): Promise<SalesContentJob> {
  return prisma.salesContentJob.create({
    data: {
      spaceId: input.spaceId,
      kind: input.kind,
      targetId: input.targetId ?? null,
      payload: (input.payload ?? undefined) as never,
      scheduledAt: input.scheduledAt ?? new Date(),
    },
  })
}

// 단일 atomic 쿼리로 PENDING + scheduledAt<=now 중 하나를 CLAIMED 로 점유.
// Postgres 9.5+ UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) 동등.
// Prisma 에서는 raw 쿼리로만 이 보장이 깔끔해서 $queryRaw 로 처리.
export async function claimJobs(params: {
  workerId: string
  kinds?: SalesContentJobKind[]
  limit?: number
}): Promise<SalesContentJob[]> {
  const limit = Math.min(params.limit ?? 5, 25)
  const kinds = params.kinds

  // SELECT ... FOR UPDATE SKIP LOCKED 로 후보 id 확보 후 UPDATE RETURNING.
  // 동시 워커가 같은 job 을 잡는 레이스를 방지한다.
  const ids = (
    await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "SalesContentJob"
     WHERE "status" = 'PENDING'
       AND "scheduledAt" <= NOW()
       ${kinds && kinds.length > 0 ? `AND "kind" = ANY($2::text[]::"SalesContentJobKind"[])` : ''}
     ORDER BY "scheduledAt" ASC
     FOR UPDATE SKIP LOCKED
     LIMIT $1`,
      limit,
      ...(kinds && kinds.length > 0 ? [kinds] : [])
    )
  ).map((r) => r.id)

  if (ids.length === 0) return []

  const claimed = await prisma.salesContentJob.updateMany({
    where: { id: { in: ids }, status: 'PENDING' },
    data: {
      status: 'CLAIMED',
      claimedBy: params.workerId,
      claimedAt: new Date(),
      attempts: { increment: 1 },
    },
  })
  if (claimed.count === 0) return []

  return prisma.salesContentJob.findMany({
    where: { id: { in: ids }, status: 'CLAIMED', claimedBy: params.workerId },
  })
}

export async function completeJob(jobId: string): Promise<void> {
  await prisma.salesContentJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', completedAt: new Date(), errorMessage: null },
  })
}

// 실패: attempts 한도 이하면 PENDING 재스케줄, 초과면 FAILED 고정.
export async function failJob(jobId: string, errorMessage: string): Promise<void> {
  const job = await prisma.salesContentJob.findUnique({
    where: { id: jobId },
    select: { attempts: true },
  })
  if (!job) return

  if (job.attempts >= MAX_ATTEMPTS) {
    await prisma.salesContentJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorMessage: errorMessage.slice(0, 1000),
      },
    })
  } else {
    await prisma.salesContentJob.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        claimedBy: null,
        claimedAt: null,
        scheduledAt: nextRetryAt(job.attempts),
        errorMessage: errorMessage.slice(0, 1000),
      },
    })
  }
}
