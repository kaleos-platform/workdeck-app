// SalesContentJob 헬퍼 — enqueue / atomic claim / complete.

import { prisma } from '@/lib/prisma'
import type { SalesContentJobKind, SalesContentJob } from '@/generated/prisma/client'

export const MAX_ATTEMPTS = 3
// 재시도 백오프(ms): 1m / 5m / 15m
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000]

// 워커가 OOM/SIGKILL 등으로 /complete 보고 없이 죽으면 job 은 영구 CLAIMED. 그것을 회복할
// stale 임계치. Naver Playwright publish 가 가장 오래 걸리는 작업(~60s)이므로 10분이면 충분.
// SC_STALE_CLAIM_MS env 로 override 가능.
export const STALE_CLAIM_MS = Number(process.env.SC_STALE_CLAIM_MS ?? '600000')

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

/** Stale CLAIMED job 회복.
 *
 * 워커 OOM/SIGKILL 또는 네트워크 분리로 /complete 보고가 영원히 도달하지 않는 경우
 * job 은 status=CLAIMED 인 채로 남는다. claimJobs 는 PENDING 만 select 하므로 영영
 * 잡히지 않음. 일정 시간 (STALE_CLAIM_MS) 경과한 CLAIMED 를 PENDING 으로 되돌려 회복.
 *
 * 정책: attempts 는 보존 (이미 increment 되어 있음 — 진짜 작업했을 가능성을 존중).
 * 영구 stale 이 반복되면 결국 attempts >= MAX_ATTEMPTS 에 도달해 자동 FAILED 로 종료.
 *
 * 반환: 회복된 row 개수.
 */
export async function reapStaleClaims(maxAgeMs: number = STALE_CLAIM_MS): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs)
  const result = await prisma.salesContentJob.updateMany({
    where: { status: 'CLAIMED', claimedAt: { lt: cutoff } },
    data: {
      status: 'PENDING',
      claimedBy: null,
      claimedAt: null,
      // scheduledAt 은 그대로 둔다 — 즉시 다음 poll 에서 재선점되도록.
    },
  })
  return result.count
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

/** CLAIMED 상태에서만 COMPLETED 로 finalize. 이미 종료된 job 의 중복 보고는 묵묵히 무시. */
export async function completeJob(jobId: string): Promise<{ updated: boolean }> {
  const result = await prisma.salesContentJob.updateMany({
    where: { id: jobId, status: 'CLAIMED' },
    data: { status: 'COMPLETED', completedAt: new Date(), errorMessage: null },
  })
  return { updated: result.count > 0 }
}

// 실패: attempts 한도 이하면 PENDING 재스케줄, 초과면 FAILED 고정.
// nonRetryable=true 이면 attempts 와 무관하게 즉시 FAILED 로 고정한다.
// 호출 측은 Publisher/Collector 의 errorCode 가 AUTH_FAILED · VALIDATION · NOT_IMPLEMENTED ·
// RATE_LIMITED 처럼 자격증명·구현·외부 quota 문제일 때 nonRetryable=true 로 넘긴다.
/** CLAIMED 상태에서만 mutate.
 * 이미 COMPLETED/FAILED 인 job 에 대한 중복 ok:false 보고는 무시 (no downgrade). */
export async function failJob(
  jobId: string,
  errorMessage: string,
  options: { nonRetryable?: boolean } = {}
): Promise<{ updated: boolean; finalized: boolean }> {
  const job = await prisma.salesContentJob.findUnique({
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
        scheduledAt: nextRetryAt(job.attempts),
        errorMessage: errorMessage.slice(0, 1000),
      }

  const result = await prisma.salesContentJob.updateMany({
    where: { id: jobId, status: 'CLAIMED' },
    data: next,
  })

  return { updated: result.count > 0, finalized: shouldFinalize }
}

// 워커 에러코드 → retry 가능 여부.
// NETWORK / PLATFORM_ERROR 는 일시적 — 재시도 가능.
// 그 외(AUTH_FAILED, RATE_LIMITED, VALIDATION, NOT_IMPLEMENTED) 는 자격증명·구현 문제 — 즉시 FAILED.
const RETRYABLE_ERROR_CODES = new Set(['NETWORK', 'PLATFORM_ERROR'])
export function isRetryableErrorCode(errorCode: string | null | undefined): boolean {
  if (!errorCode) return true
  return RETRYABLE_ERROR_CODES.has(errorCode)
}
