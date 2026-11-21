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
  try {
    await prisma.pipelineOperation.create({
      data: {
        id: operationId,
        spaceId: setting.spaceId,
        channelId,
        kind: 'OBSERVE',
        startedAt: now,
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
    cursor: asCursor(setting.observeCursor),
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
  /** 조회 끝 시각 — 요청한 전체 기간의 끝. */
  through?: string
  pagesRequested?: number
  pagesIngested?: number
  rows?: number
  errorCode?: string
}

/**
 * 커서는 여기서만 전진한다: 전체 성공 + 현재 lease 소유자 + 커서 역행 아님.
 * 아니면 커서는 그대로이고 operation 은 FAILED. accepted=false 는 오래된/중복 finish 거부.
 */
export async function finishObserve(
  input: FinishObserveInput,
  now: Date
): Promise<{ accepted: boolean; status: 'SUCCEEDED' | 'FAILED'; cursor?: ObserveCursor }> {
  return prisma.$transaction(async (tx) => {
    const op = await tx.pipelineOperation.findUnique({ where: { id: input.operationId } })
    if (!op || op.kind !== 'OBSERVE' || !op.channelId) {
      throw new ChannelOrderError('not_found', 'operation 을 찾을 수 없습니다')
    }
    if (op.status !== 'STARTED') return { accepted: false, status: 'FAILED' as const }
    const { owned, cursor } = await lockLease(tx, op.channelId, op.id, now)
    const setting = await tx.channelFulfillmentSetting.findUniqueOrThrow({
      where: { channelId: op.channelId },
    })
    const through = input.through ? Date.parse(input.through) : NaN
    const complete =
      input.success &&
      input.pagesRequested !== undefined &&
      input.pagesRequested === input.pagesIngested &&
      Number.isFinite(through) &&
      through <= now.getTime() + 60_000 &&
      (!cursor || through >= Date.parse(cursor.at))
    const counts = {
      pagesRequested: input.pagesRequested ?? null,
      pagesIngested: input.pagesIngested ?? null,
      rows: input.rows ?? null,
    }
    if (!owned) {
      await tx.pipelineOperation.update({
        where: { id: op.id },
        data: { status: 'FAILED', error: 'lease_lost', counts, finishedAt: now },
      })
      return { accepted: false, status: 'FAILED' as const }
    }
    if (!complete) {
      await tx.channelFulfillmentSetting.update({
        where: { channelId: op.channelId },
        data: { observeLease: Prisma.DbNull },
      })
      await tx.pipelineOperation.update({
        where: { id: op.id },
        data: {
          status: 'FAILED',
          error: input.success ? 'structure_invalid' : toErrorCode(input.errorCode),
          counts,
          finishedAt: now,
        },
      })
      return { accepted: true, status: 'FAILED' as const }
    }
    const { windowMs } = ADAPTER_WINDOW[setting.adapter as Adapter]
    const next: ObserveCursor = {
      at: new Date(through).toISOString(),
      catchingUp: through < now.getTime() - windowMs,
    }
    await tx.channelFulfillmentSetting.update({
      where: { channelId: op.channelId },
      data: { observeCursor: next, observeLease: Prisma.DbNull },
    })
    await tx.pipelineOperation.update({
      where: { id: op.id },
      data: { status: 'SUCCEEDED', counts, finishedAt: now },
    })
    return { accepted: true, status: 'SUCCEEDED' as const, cursor: next }
  })
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
  const op = await prisma.pipelineOperation.create({
    data: { spaceId: setting.spaceId, channelId, kind: 'FULL_SCAN', startedAt: now },
  })
  return {
    operationId: op.id,
    spaceId: setting.spaceId,
    adapter: setting.adapter as Adapter,
    storeKey: setting.storeKey,
  }
}

export type FinishScanInput = {
  operationId: string
  success: boolean
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
  const complete =
    input.success && input.structureOk && input.pagesRequested === input.pagesReceived
  const status = complete ? 'SUCCEEDED' : input.pagesReceived > 0 ? 'PARTIAL' : 'FAILED'
  await prisma.pipelineOperation.update({
    where: { id: op.id },
    data: {
      status,
      error: complete
        ? null
        : input.structureOk
          ? toErrorCode(input.errorCode)
          : 'structure_invalid',
      counts: {
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        pagesRequested: input.pagesRequested,
        pagesReceived: input.pagesReceived,
        structureOk: input.structureOk,
        rows,
      },
      finishedAt: now,
    },
  })
  return { accepted: true, status }
}

/** 14일 지난 전수 조회 행 삭제. */
export async function purgeOldScanLines(now: Date): Promise<number> {
  const r = await prisma.channelOrderScanLine.deleteMany({
    where: { operation: { startedAt: { lt: new Date(now.getTime() - 14 * 86_400_000) } } },
  })
  return r.count
}
