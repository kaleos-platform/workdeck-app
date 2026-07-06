// BoJob 헬퍼 — enqueue / atomic claim / complete.
// sc/jobs.ts 와 동일한 패턴. Prisma BoJob 모델 사용.

import { prisma } from '@/lib/prisma'
import type { BoJobKind, BoJob } from '@/generated/prisma/client'

export const MAX_ATTEMPTS = 3
// 재시도 백오프(ms): 1분 / 5분 / 15분
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000]

// BO_STALE_CLAIM_MS env 로 override 가능. 기본 10분.
export const STALE_CLAIM_MS = Number(process.env.BO_STALE_CLAIM_MS ?? '600000')

export function nextBoRetryAt(attempts: number, now: Date = new Date()): Date {
  const ms = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]
  return new Date(now.getTime() + ms)
}

export async function enqueueBoJob(input: {
  spaceId: string
  kind: BoJobKind
  targetId?: string | null
  payload?: unknown
  scheduledAt?: Date
}): Promise<BoJob> {
  return prisma.boJob.create({
    data: {
      spaceId: input.spaceId,
      kind: input.kind,
      targetId: input.targetId ?? null,
      payload: (input.payload ?? undefined) as never,
      scheduledAt: input.scheduledAt ?? new Date(),
    },
  })
}

/** Stale CLAIMED job 회복.
 *
 * 워커 OOM/SIGKILL 또는 네트워크 분리로 /complete 보고가 없는 경우
 * CLAIMED 상태로 남은 job 을 PENDING 으로 되돌려 재처리 가능하게 한다.
 */
export async function reapStaleBoClaims(maxAgeMs: number = STALE_CLAIM_MS): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs)
  const result = await prisma.boJob.updateMany({
    where: { status: 'CLAIMED', claimedAt: { lt: cutoff } },
    data: {
      status: 'PENDING',
      claimedBy: null,
      claimedAt: null,
    },
  })
  return result.count
}

// SELECT ... FOR UPDATE SKIP LOCKED 로 단일 BoJob 를 원자적으로 점유.
// 동시 워커가 같은 job 을 잡는 레이스를 방지한다.
export async function claimNextBoJob(params: {
  workerId: string
  kinds?: BoJobKind[]
}): Promise<BoJob | null> {
  const kinds = params.kinds

  const ids = (
    await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "BoJob"
       WHERE "status" = 'PENDING'
         AND "scheduledAt" <= NOW()
         ${kinds && kinds.length > 0 ? `AND "kind" = ANY($2::text[]::"BoJobKind"[])` : ''}
       ORDER BY "scheduledAt" ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      1,
      ...(kinds && kinds.length > 0 ? [kinds] : [])
    )
  ).map((r) => r.id)

  if (ids.length === 0) return null

  const claimed = await prisma.boJob.updateMany({
    where: { id: { in: ids }, status: 'PENDING' },
    data: {
      status: 'CLAIMED',
      claimedBy: params.workerId,
      claimedAt: new Date(),
      attempts: { increment: 1 },
    },
  })
  if (claimed.count === 0) return null

  const jobs = await prisma.boJob.findMany({
    where: { id: { in: ids }, status: 'CLAIMED', claimedBy: params.workerId },
  })
  return jobs[0] ?? null
}

/** CLAIMED 상태에서만 COMPLETED 로 종료. 이미 종료된 job 의 중복 보고는 무시. */
export async function completeBoJob(jobId: string): Promise<{ updated: boolean }> {
  const result = await prisma.boJob.updateMany({
    where: { id: jobId, status: 'CLAIMED' },
    data: { status: 'COMPLETED', completedAt: new Date(), errorMessage: null },
  })
  return { updated: result.count > 0 }
}

/** CLAIMED 상태에서 실패. attempts 한도 이하면 PENDING 재스케줄, 초과면 FAILED 고정.
 *  nonRetryable=true 이면 attempts 무관하게 즉시 FAILED. */
export async function failBoJob(
  jobId: string,
  errorMessage: string,
  options: { nonRetryable?: boolean } = {}
): Promise<{ updated: boolean; finalized: boolean }> {
  const job = await prisma.boJob.findUnique({
    where: { id: jobId },
    select: { attempts: true, status: true },
  })
  if (!job) return { updated: false, finalized: false }

  const shouldFinalize = options.nonRetryable || job.attempts >= MAX_ATTEMPTS
  const next = shouldFinalize
    ? {
        status: 'FAILED' as const,
        completedAt: new Date(),
        errorMessage: errorMessage.slice(0, 1000),
      }
    : {
        status: 'PENDING' as const,
        claimedBy: null,
        claimedAt: null,
        scheduledAt: nextBoRetryAt(job.attempts),
        errorMessage: errorMessage.slice(0, 1000),
      }

  const result = await prisma.boJob.updateMany({
    where: { id: jobId, status: 'CLAIMED' },
    data: next,
  })
  return { updated: result.count > 0, finalized: shouldFinalize }
}

// 워커가 보고할 수 있는 에러코드
export const BO_WORKER_ERROR_CODES = [
  'AUTH_FAILED',
  'RATE_LIMITED',
  'VALIDATION',
  'PLATFORM_ERROR',
  'NOT_IMPLEMENTED',
  'NETWORK',
] as const
export type BoWorkerErrorCode = (typeof BO_WORKER_ERROR_CODES)[number]

const RETRYABLE_ERROR_CODES = new Set<BoWorkerErrorCode>(['NETWORK', 'PLATFORM_ERROR'])

export function isBoRetryableErrorCode(errorCode: string | null | undefined): boolean {
  if (!errorCode) return true
  return RETRYABLE_ERROR_CODES.has(errorCode as BoWorkerErrorCode)
}
