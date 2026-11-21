/** 관측 행·전수 조회 행 적재. 개인정보 필드는 zod strict 로 거부(types.ts). */
import { prisma } from '@/lib/prisma'
import { lockLease } from './operations'
import { rawHashOf } from './normalize'
import {
  ChannelOrderError,
  LEASE_MS,
  MAX_INGEST_LINES,
  OrderLineInputSchema,
  ScanLineInputSchema,
  type OrderLineInput,
  type ScanLineInput,
} from './types'
import { z } from 'zod'

const d = (v?: string | null) => (v ? new Date(v) : null)
/** interactive 트랜잭션 한도 — 기본 5초는 원격 DB 왕복 300행 처리에 빠듯하다. */
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 }

export type IngestResult = {
  created: number
  updated: number
  unchanged: number
  staleSkipped: number
}

/**
 * 행 쓰기와 같은 트랜잭션에서 lease 소유·미만료를 확인한다(아니면 lease_lost, 아무것도 안 씀).
 * 멱등: 같은 키·같은 rawHash 면 lastSeenAt 만 갱신. 원본 변경 시각이 저장값보다 오래되면 덮어쓰지 않는다.
 */
export async function ingestLines(
  operationId: string,
  rawLines: unknown,
  now = new Date()
): Promise<IngestResult> {
  const parsed = z.array(OrderLineInputSchema).max(MAX_INGEST_LINES).safeParse(rawLines)
  if (!parsed.success) throw new ChannelOrderError('invalid', '행 형식이 올바르지 않습니다')
  const lines: OrderLineInput[] = [
    ...new Map(parsed.data.map((l) => [l.externalLineKey, l])).values(),
  ]

  return prisma.$transaction(async (tx) => {
    const op = await tx.pipelineOperation.findUnique({ where: { id: operationId } })
    if (!op || op.kind !== 'OBSERVE' || op.status !== 'STARTED' || !op.channelId) {
      throw new ChannelOrderError('lease_lost', '유효하지 않은 operation 입니다')
    }
    const { owned } = await lockLease(tx, op.channelId, operationId, now)
    if (!owned) throw new ChannelOrderError('lease_lost', 'lease 가 없거나 만료되었습니다')
    // 서버가 실제로 받은 호출·행 수(워커 신고값과 무관) — finish 검증에 쓴다. 설정 행 잠금 안이라 경합 없음.
    await tx.pipelineOperation.update({
      where: { id: operationId },
      data: { ingestCalls: { increment: 1 }, ingestRows: { increment: lines.length } },
    })

    const existing = await tx.channelOrderLine.findMany({
      where: {
        channelId: op.channelId,
        externalLineKey: { in: lines.map((l) => l.externalLineKey) },
      },
      select: { id: true, externalLineKey: true, rawHash: true, sourceChangedAt: true },
    })
    const byKey = new Map(existing.map((e) => [e.externalLineKey, e]))
    const res: IngestResult = { created: 0, updated: 0, unchanged: 0, staleSkipped: 0 }
    const touchIds: string[] = []
    const creates = []
    for (const l of lines) {
      const rawHash = rawHashOf(l)
      const data = {
        externalOrderId: l.externalOrderId,
        paidAt: new Date(l.paidAt),
        productName: l.productName,
        optionText: l.optionText ?? null,
        quantity: l.quantity,
        channelStatus: l.channelStatus,
        claimStatus: l.claimStatus ?? null,
        deliveryKind: l.deliveryKind,
        shippingDueAt: d(l.shippingDueAt),
        carrierCode: l.carrierCode ?? null,
        trackingNumber: l.trackingNumber ?? null,
        dispatchedAt: d(l.dispatchedAt),
        sourceChangedAt: d(l.sourceChangedAt),
        rawHash,
        lastSeenAt: now,
      }
      const cur = byKey.get(l.externalLineKey)
      if (!cur) {
        creates.push({
          ...data,
          spaceId: op.spaceId,
          channelId: op.channelId,
          externalLineKey: l.externalLineKey,
          firstSeenAt: now,
        })
        res.created++
      } else if (
        data.sourceChangedAt &&
        cur.sourceChangedAt &&
        data.sourceChangedAt.getTime() < cur.sourceChangedAt.getTime()
      ) {
        res.staleSkipped++
      } else if (cur.rawHash === rawHash) {
        touchIds.push(cur.id)
        res.unchanged++
      } else {
        await tx.channelOrderLine.update({ where: { id: cur.id }, data })
        res.updated++
      }
    }
    if (creates.length) await tx.channelOrderLine.createMany({ data: creates })
    if (touchIds.length) {
      await tx.channelOrderLine.updateMany({
        where: { id: { in: touchIds } },
        data: { lastSeenAt: now },
      })
    }
    return res
  }, TX_OPTIONS)
}

/** 전수 조회 행 적재 — FULL_SCAN operation 이 진행 중(15분 이내)일 때만. (operationId, externalLineKey) 로 중복 제거. */
export async function ingestScanLines(
  operationId: string,
  rawLines: unknown,
  now = new Date()
): Promise<{ inserted: number }> {
  const parsed = z.array(ScanLineInputSchema).max(MAX_INGEST_LINES).safeParse(rawLines)
  if (!parsed.success) throw new ChannelOrderError('invalid', '행 형식이 올바르지 않습니다')
  const lines: ScanLineInput[] = parsed.data
  return prisma.$transaction(async (tx) => {
    const op = await tx.pipelineOperation.findUnique({ where: { id: operationId } })
    if (
      !op ||
      op.kind !== 'FULL_SCAN' ||
      op.status !== 'STARTED' ||
      !op.channelId ||
      op.startedAt.getTime() < now.getTime() - LEASE_MS
    ) {
      throw new ChannelOrderError('lease_lost', '유효하지 않은 operation 입니다')
    }
    // 상태 조건부 갱신이 곧 행 잠금 — 마감과 경합해도 마감 뒤에는 쓰지 않는다.
    const claimed = await tx.pipelineOperation.updateMany({
      where: { id: operationId, status: 'STARTED' },
      data: { ingestCalls: { increment: 1 }, ingestRows: { increment: lines.length } },
    })
    if (claimed.count !== 1)
      throw new ChannelOrderError('lease_lost', '유효하지 않은 operation 입니다')
    const r = await tx.channelOrderScanLine.createMany({
      data: lines.map((l) => ({
        operationId,
        channelId: op.channelId as string,
        externalLineKey: l.externalLineKey,
        externalOrderId: l.externalOrderId,
        quantity: l.quantity,
        channelStatus: l.channelStatus,
        paidAt: new Date(l.paidAt),
      })),
      skipDuplicates: true,
    })
    return { inserted: r.count }
  }, TX_OPTIONS)
}
