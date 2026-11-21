/**
 * 채널 주문 관측의 실행 제어 — lease(조건부 쓰기)·operation 기록·커서(finish 에서만 전진)·조회 창 계산.
 * 채널당 동시 실행 금지: observeLease 를 raw SQL 조건부 UPDATE 로 잡고, ingest/finish 는 같은 설정 행을
 * FOR UPDATE 로 잠근 트랜잭션 안에서 lease 소유·미만료를 확인한다.
 */
import crypto from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import {
  ADAPTER_WINDOW,
  BACKFILL_DAYS,
  ChannelOrderError,
  LEASE_MS,
  OBSERVE_MAX_WINDOWS,
  SCAN_DAYS,
  kstMidnight,
  toErrorCode,
  type Adapter,
  type ObserveCursor,
  type ObserveLease,
} from './types'

export type Tx = Prisma.TransactionClient
export type Window = { from: Date; to: Date }

/** 조회 창 목록. 커서가 없으면 14일 전부터, 있으면 커서−겹침부터 now 까지 채널 한도로 쪼갠다. */
export function planWindows(
  adapter: Adapter,
  cursor: ObserveCursor | null,
  now: Date,
  maxWindows = Infinity
): Window[] {
  const { windowMs, overlapMs } = ADAPTER_WINDOW[adapter]
  const start = cursor
    ? Date.parse(cursor.at) - overlapMs
    : now.getTime() - BACKFILL_DAYS * 86_400_000
  const out: Window[] = []
  for (let t = start; t < now.getTime() && out.length < maxWindows; t += windowMs) {
    out.push({ from: new Date(t), to: new Date(Math.min(t + windowMs, now.getTime())) })
  }
  return out
}

const DAY = 86_400_000

/**
 * 전수 조회 창 — KST 자정에 맞춘 일자 단위, 겹침 없음. 첫 창은 KST 자정 기준 7일 전 00:00, 마지막 창은 now 까지.
 * 창의 to 는 그 날 마지막 ms 라 kstDay(from)==kstDay(to) 이다(일자 단위 API 의 end_date 가 다음 날로 넘어가지 않는다).
 */
export function scanWindows(now: Date): Window[] {
  const out: Window[] = []
  for (let t = kstMidnight(now) - SCAN_DAYS * DAY; t <= now.getTime(); t += DAY) {
    out.push({ from: new Date(t), to: new Date(Math.min(t + DAY - 1, now.getTime())) })
  }
  return out
}

/** 15분 넘게 STARTED 인 operation 을 FAILED(timeout)로 정리한다. */
export async function cleanupStaleOperations(now: Date): Promise<number> {
  const r = await prisma.pipelineOperation.updateMany({
    where: {
      kind: { in: ['OBSERVE', 'FULL_SCAN'] },
      status: 'STARTED',
      startedAt: { lt: new Date(now.getTime() - LEASE_MS) },
    },
    data: { status: 'FAILED', error: 'timeout', finishedAt: now },
  })
  return r.count
}

const asCursor = (v: unknown): ObserveCursor | null => {
  const c = v as Partial<ObserveCursor> | null
  return c && typeof c.at === 'string' ? { at: c.at, catchingUp: Boolean(c.catchingUp) } : null
}

export type StartedObserve = {
  operationId: string
  spaceId: string
  channelId: string
  adapter: Adapter
  storeKey: string | null
  cursor: ObserveCursor | null
  /** 서버가 계획한 조회 창 — 워커·어댑터는 이것만 읽는다. */
  windows: Window[]
}

/** observeEnabled 채널의 lease 를 조건부로 잡고 OBSERVE operation 을 만든다. 이미 실행 중이면 busy. */
export async function startObserve(channelId: string, now: Date): Promise<StartedObserve> {
  await cleanupStaleOperations(now)
  const setting = await prisma.channelFulfillmentSetting.findUnique({ where: { channelId } })
  if (!setting || !setting.observeEnabled) {
    throw new ChannelOrderError('not_found', '주문 관측이 켜져 있지 않습니다')
  }
  const operationId = crypto.randomUUID()
  const lease: ObserveLease = { operationId, until: now.getTime() + LEASE_MS }
  const got = await prisma.$executeRaw`
    UPDATE "ChannelFulfillmentSetting"
    SET "observeLease" = ${JSON.stringify(lease)}::jsonb
    WHERE "channelId" = ${channelId} AND "observeEnabled" = true
      AND ("observeLease" IS NULL OR ("observeLease"->>'until')::bigint <= ${now.getTime()})`
  if (got !== 1) throw new ChannelOrderError('busy', '이미 실행 중입니다')
  const cursor = asCursor(setting.observeCursor)
  const windows = planWindows(setting.adapter as Adapter, cursor, now, OBSERVE_MAX_WINDOWS)
  try {
    await prisma.pipelineOperation.create({
      data: {
        id: operationId,
        spaceId: setting.spaceId,
        channelId,
        kind: 'OBSERVE',
        startedAt: now,
        plannedFrom: windows[0]?.from ?? null,
        plannedThrough: windows.at(-1)?.to ?? null,
        minCalls: 1,
      },
    })
  } catch (err) {
    await releaseLease(channelId, operationId)
    throw err
  }
  return {
    operationId,
    spaceId: setting.spaceId,
    channelId,
    adapter: setting.adapter as Adapter,
    storeKey: setting.storeKey,
    cursor,
    windows,
  }
}

async function releaseLease(channelId: string, operationId: string) {
  await prisma.$executeRaw`
    UPDATE "ChannelFulfillmentSetting" SET "observeLease" = NULL
    WHERE "channelId" = ${channelId} AND "observeLease"->>'operationId' = ${operationId}`
}

/** 설정 행을 잠그고 operation 이 현재 유효한 lease 소유자인지 본다(트랜잭션 안). */
export async function lockLease(tx: Tx, channelId: string, operationId: string, now: Date) {
  const rows = await tx.$queryRaw<
    Array<{ observeLease: ObserveLease | null; observeCursor: unknown }>
  >`SELECT "observeLease", "observeCursor" FROM "ChannelFulfillmentSetting"
    WHERE "channelId" = ${channelId} FOR UPDATE`
  const row = rows[0]
  const lease = row?.observeLease
  const owned = Boolean(
    lease && lease.operationId === operationId && Number(lease.until) > now.getTime()
  )
  return { owned, cursor: asCursor(row?.observeCursor) }
}

export type FinishObserveInput = {
  operationId: string
  success: boolean
  /** 워커가 신고한 조회 끝 시각 — 서버가 start 에서 계획한 끝(plannedThrough)과 같아야 인정한다. */
  through?: string
  pagesRequested?: number
  pagesIngested?: number
  rows?: number
  errorCode?: string
}

/**
 * 커서는 여기서만 전진한다: 전체 성공 + 현재 lease 소유자 + 서버 계획과 일치 + 서버가 받은 ingest 호출 충분.
 * 아니면 커서는 그대로이고 operation 은 FAILED. accepted=false 는 오래된/중복 finish 거부.
 * op 상태 확인은 설정 행 잠금(lockLease) 뒤에 하고, 상태 변경은 status='STARTED' 조건부 —
 * 동시 finish 두 번이어도 하나만 성공하고 SUCCEEDED 는 덮어쓰이지 않는다.
 */
export async function finishObserve(
  input: FinishObserveInput,
  now: Date
): Promise<{ accepted: boolean; status: 'SUCCEEDED' | 'FAILED'; cursor?: ObserveCursor }> {
  return prisma.$transaction(
    async (tx) => {
      const found = await tx.pipelineOperation.findUnique({ where: { id: input.operationId } })
      if (!found || found.kind !== 'OBSERVE' || !found.channelId) {
        throw new ChannelOrderError('not_found', 'operation 을 찾을 수 없습니다')
      }
      const channelId = found.channelId
      const { owned, cursor } = await lockLease(tx, channelId, found.id, now)
      // 잠금을 얻은 뒤의 최신 상태 — 먼저 끝난 finish 가 있으면 거부.
      const op = await tx.pipelineOperation.findUniqueOrThrow({ where: { id: found.id } })
      if (op.status !== 'STARTED') return { accepted: false, status: 'FAILED' as const }
      const setting = await tx.channelFulfillmentSetting.findUniqueOrThrow({ where: { channelId } })
      const through = input.through ? Date.parse(input.through) : NaN
      const planned = op.plannedThrough?.getTime()
      const planOk = planned !== undefined && through === planned
      const callsOk = op.ingestCalls >= Math.max(op.minCalls, input.pagesIngested ?? 0)
      const complete =
        input.success &&
        input.pagesRequested !== undefined &&
        input.pagesRequested === input.pagesIngested &&
        planOk &&
        callsOk &&
        (!cursor || through >= Date.parse(cursor.at))
      const counts = {
        pagesRequested: input.pagesRequested ?? null,
        pagesIngested: input.pagesIngested ?? null,
        rows: input.rows ?? null,
        ingestCalls: op.ingestCalls,
        ingestRows: op.ingestRows,
      }
      const close = async (data: Prisma.PipelineOperationUpdateManyMutationInput) =>
        (
          await tx.pipelineOperation.updateMany({
            where: { id: op.id, status: 'STARTED' },
            data: { ...data, counts, finishedAt: now },
          })
        ).count === 1
      if (!owned) {
        await close({ status: 'FAILED', error: 'lease_lost' })
        return { accepted: false, status: 'FAILED' as const }
      }
      if (!complete) {
        const error = !input.success
          ? toErrorCode(input.errorCode)
          : !planOk
            ? 'plan_mismatch'
            : !callsOk
              ? 'ingest_missing'
              : 'structure_invalid'
        if (!(await close({ status: 'FAILED', error }))) {
          return { accepted: false, status: 'FAILED' as const }
        }
        await tx.channelFulfillmentSetting.update({
          where: { channelId },
          data: { observeLease: Prisma.DbNull },
        })
        return { accepted: true, status: 'FAILED' as const }
      }
      if (!(await close({ status: 'SUCCEEDED' }))) {
        return { accepted: false, status: 'FAILED' as const }
      }
      const { windowMs } = ADAPTER_WINDOW[setting.adapter as Adapter]
      const next: ObserveCursor = {
        at: new Date(through).toISOString(),
        catchingUp: through < now.getTime() - windowMs,
      }
      await tx.channelFulfillmentSetting.update({
        where: { channelId },
        data: { observeCursor: next, observeLease: Prisma.DbNull },
      })
      return { accepted: true, status: 'SUCCEEDED' as const, cursor: next }
    },
    { timeout: 20_000 }
  )
}

// ─── 일일 전수 조회 ───────────────────────────────────────────────────────────

/** ponytail: 채널당 STARTED FULL_SCAN 존재 확인은 조건부 쓰기가 아니라 조회 — 겹쳐 시작되어도 대사는 최신 SUCCEEDED 하나만 본다. */
export async function startFullScan(channelId: string, now: Date) {
  await cleanupStaleOperations(now)
  const setting = await prisma.channelFulfillmentSetting.findUnique({ where: { channelId } })
  if (!setting || !setting.observeEnabled) {
    throw new ChannelOrderError('not_found', '주문 관측이 켜져 있지 않습니다')
  }
  const running = await prisma.pipelineOperation.findFirst({
    where: { channelId, kind: 'FULL_SCAN', status: 'STARTED' },
    select: { id: true },
  })
  if (running) throw new ChannelOrderError('busy', '이미 전수 조회 중입니다')
  const windows = scanWindows(now)
  const op = await prisma.pipelineOperation.create({
    data: {
      spaceId: setting.spaceId,
      channelId,
      kind: 'FULL_SCAN',
      startedAt: now,
      plannedFrom: windows[0].from,
      plannedThrough: now,
      minCalls: windows.length, // 일자 창마다 적어도 1번은 ingest 해야 한다
    },
  })
  return {
    operationId: op.id,
    spaceId: setting.spaceId,
    adapter: setting.adapter as Adapter,
    storeKey: setting.storeKey,
    windows,
  }
}

export type FinishScanInput = {
  operationId: string
  success: boolean
  /** 워커 신고값 — periodTo 는 서버 계획 끝과 같아야 한다. periodFrom 은 기록에 쓰지 않는다(서버 저장값 사용). */
  periodFrom: string
  periodTo: string
  pagesRequested: number
  pagesReceived: number
  /** 응답에 data/contents(orders) 구조가 모두 있었는지 */
  structureOk: boolean
  errorCode?: string
}

export async function finishFullScan(
  input: FinishScanInput,
  now: Date
): Promise<{ accepted: boolean; status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' }> {
  const op = await prisma.pipelineOperation.findUnique({ where: { id: input.operationId } })
  if (!op || op.kind !== 'FULL_SCAN') {
    throw new ChannelOrderError('not_found', 'operation 을 찾을 수 없습니다')
  }
  if (op.status !== 'STARTED' || op.startedAt.getTime() < now.getTime() - LEASE_MS) {
    return { accepted: false, status: 'FAILED' }
  }
  const rows = await prisma.channelOrderScanLine.count({ where: { operationId: op.id } })
  const planOk =
    op.plannedThrough !== null && Date.parse(input.periodTo) === op.plannedThrough.getTime()
  const callsOk = op.ingestCalls >= Math.max(op.minCalls, input.pagesReceived)
  const complete =
    input.success &&
    input.structureOk &&
    input.pagesRequested === input.pagesReceived &&
    planOk &&
    callsOk
  const status = complete ? 'SUCCEEDED' : input.pagesReceived > 0 ? 'PARTIAL' : 'FAILED'
  const error = complete
    ? null
    : !input.structureOk
      ? 'structure_invalid'
      : !input.success
        ? toErrorCode(input.errorCode)
        : !planOk
          ? 'plan_mismatch'
          : !callsOk
            ? 'ingest_missing'
            : toErrorCode(input.errorCode)
  const r = await prisma.pipelineOperation.updateMany({
    where: { id: op.id, status: 'STARTED' },
    data: {
      status,
      error,
      counts: {
        // 기간은 워커 신고값이 아니라 서버가 start 에서 저장한 계획값
        periodFrom: op.plannedFrom?.toISOString() ?? null,
        periodTo: op.plannedThrough?.toISOString() ?? null,
        pagesRequested: input.pagesRequested,
        pagesReceived: input.pagesReceived,
        structureOk: input.structureOk,
        rows,
        ingestCalls: op.ingestCalls,
        ingestRows: op.ingestRows,
      },
      finishedAt: now,
    },
  })
  return r.count === 1 ? { accepted: true, status } : { accepted: false, status: 'FAILED' }
}

/** 14일 지난 전수 조회 행 삭제. */
export async function purgeOldScanLines(now: Date): Promise<number> {
  const r = await prisma.channelOrderScanLine.deleteMany({
    where: { operation: { startedAt: { lt: new Date(now.getTime() - 14 * 86_400_000) } } },
  })
  return r.count
}
