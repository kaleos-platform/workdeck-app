/** 관측 행·전수 조회 행 적재. 개인정보 필드는 zod strict 로 거부(types.ts). */
import { prisma } from '@/lib/prisma'
import { lockLease } from './operations'
import { rawHashOf } from './normalize'
import {
  ChannelOrderError,
  LEASE_MS,
  OrderLineInputSchema,
  ScanLineInputSchema,
  type OrderLineInput,
  type ScanLineInput,
} from './types'
import { z } from 'zod'

const d = (v?: string | null) => (v ? new Date(v) : null)

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
  const parsed = z.array(OrderLineInputSchema).max(2000).safeParse(rawLines)
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
  })
}

/** 전수 조회 행 적재 — FULL_SCAN operation 이 진행 중(15분 이내)일 때만. */
export async function ingestScanLines(
  operationId: string,
  rawLines: unknown,
  now = new Date()
): Promise<{ inserted: number }> {
  const parsed = z.array(ScanLineInputSchema).max(2000).safeParse(rawLines)
  if (!parsed.success) throw new ChannelOrderError('invalid', '행 형식이 올바르지 않습니다')
  const lines: ScanLineInput[] = parsed.data
  const op = await prisma.pipelineOperation.findUnique({ where: { id: operationId } })
  if (
    !op ||
    op.kind !== 'FULL_SCAN' ||
    op.status !== 'STARTED' ||
    !op.channelId ||
    op.startedAt.getTime() < now.getTime() - LEASE_MS
  ) {
    throw new ChannelOrderError('lease_lost', '유효하지 않은 operation 입니다')
  }
  const r = await prisma.channelOrderScanLine.createMany({
    data: lines.map((l) => ({
      operationId,
      channelId: op.channelId as string,
      externalLineKey: l.externalLineKey,
      externalOrderId: l.externalOrderId,
      quantity: l.quantity,
      channelStatus: l.channelStatus,
      paidAt: new Date(l.paidAt),
    })),
  })
  return { inserted: r.count }
}
