// N배송 일 단위 동기화: 한 스토어 × KST 하루의 상품주문을 DelBatch/DelOrder/DelOrderItem 으로
// 적재(해당 일 배치는 통째로 재생성)하고, 옵션별 합계를 3PL 위치 OUTBOUND 로 맞춘다.

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { encryptOrderPii } from '@/lib/del/encryption'
import { loadItemResolver } from '@/lib/del/resolve-order-items'
import { upsertOutboundMovement } from '@/lib/inv/coupang-sales-to-movement'
import type { NaverProductOrder } from './client'
import { EXCLUDED_STATUSES, isNbaesong, kstDay, nbaesongItemName } from './nbaesong'

type Tally = { created: number; updated: number; skipped: number }

export function nbaesongReferenceId(storeKey: string, dayKst: string, optionId: string): string {
  return `naver-nb:${storeKey}:${dayKst}:${optionId}`
}

export function nbaesongBatchLabel(storeKey: string, dayKst: string): string {
  return `N배송 ${storeKey} ${dayKst}`
}

type PreparedItem = {
  name: string
  quantity: number
  optionId: string | null
  listingId: string | null
  skuMappings: Prisma.InputJsonValue
  fulfillments: Array<{ optionId: string; quantity: number }>
}

export async function syncNbaesongDay(p: {
  spaceId: string
  storeKey: string
  channelId: string
  locationId: string
  representativeChannelId: string | null
  dayKst: string
  orders: NaverProductOrder[]
}): Promise<{
  orders: number
  items: number
  unmatched: number
  skippedExisting: number
  outbound: Tally
}> {
  const { spaceId, storeKey, channelId, locationId, representativeChannelId, dayKst } = p

  let kept = p.orders.filter(
    (po) =>
      isNbaesong(po) &&
      kstDay(po.paymentDate) === dayKst &&
      !EXCLUDED_STATUSES.has(po.productOrderStatus) &&
      po.remainQuantity > 0
  )

  // 엑셀로 이미 적재된 주문(대표 채널)은 제외 — 이중 차감 방지
  let skippedExisting = 0
  if (representativeChannelId && kept.length > 0) {
    const imported = await prisma.delOrder.findMany({
      where: {
        spaceId,
        channelId: representativeChannelId,
        orderNumber: { in: Array.from(new Set(kept.map((k) => k.orderId))) },
        batch: { source: { not: 'NAVER_API' } },
      },
      select: { orderNumber: true },
    })
    const skip = new Set(imported.map((i) => i.orderNumber))
    skippedExisting = skip.size
    kept = kept.filter((k) => !skip.has(k.orderId))
  }

  const bcKey = (nsBarcode: string) => `bc:${nsBarcode}`
  const resolve = await loadItemResolver(
    spaceId,
    [channelId, representativeChannelId].filter((v): v is string => !!v),
    kept.flatMap((k) => [nbaesongItemName(k), ...k.skuMappings.map((m) => bcKey(m.nsBarcode))])
  )

  const groups = new Map<string, { paidAt: Date[]; amount: number; items: PreparedItem[] }>()
  let unmatched = 0
  for (const po of kept) {
    let item: PreparedItem | null = null
    if (po.skuMappings.length > 0) {
      const rs = po.skuMappings.map((m) =>
        resolve(bcKey(m.nsBarcode), po.remainQuantity * m.pickingQuantityPerOrder)
      )
      if (rs.every((r) => r.optionId)) {
        item = {
          name: po.productName,
          quantity: po.remainQuantity,
          optionId: null,
          listingId: null,
          skuMappings: po.skuMappings,
          fulfillments: rs.map((r) => ({ optionId: r.optionId as string, quantity: r.quantity })),
        }
      }
    }
    if (!item) {
      const r = resolve(nbaesongItemName(po), po.remainQuantity)
      item = {
        name: po.productName,
        quantity: po.remainQuantity,
        optionId: r.optionId,
        listingId: r.listingId,
        skuMappings: po.skuMappings,
        fulfillments: r.fulfillments,
      }
    }
    if (!item.optionId && !item.listingId && item.fulfillments.length === 0) unmatched++
    const g = groups.get(po.orderId) ?? { paidAt: [], amount: 0, items: [] }
    g.paidAt.push(new Date(po.paymentDate))
    g.amount += po.remainPaymentAmount
    g.items.push(item)
    groups.set(po.orderId, g)
  }

  const label = nbaesongBatchLabel(storeKey, dayKst)
  await prisma.$transaction(
    async (tx) => {
      const existing = await tx.delBatch.findFirst({
        where: { spaceId, source: 'NAVER_API', label },
        select: { id: true },
      })
      if (groups.size === 0) {
        if (existing) await tx.delBatch.delete({ where: { id: existing.id } })
        return
      }
      const batchId =
        existing?.id ??
        (
          await tx.delBatch.create({
            data: {
              spaceId,
              source: 'NAVER_API',
              label,
              status: 'COMPLETED',
              completedAt: new Date(),
            },
            select: { id: true },
          })
        ).id
      await tx.delOrder.deleteMany({ where: { batchId } })
      const pii = encryptOrderPii({ recipientName: 'N배송', phone: '-', address: '-' })
      for (const [orderId, g] of groups) {
        await tx.delOrder.create({
          data: {
            spaceId,
            batchId,
            channelId,
            shippingMethodId: null,
            ...pii,
            orderNumber: orderId,
            orderDate: new Date(Math.min(...g.paidAt.map((d) => d.getTime()))),
            paymentAmount: g.amount,
            items: {
              create: g.items.map((it) => ({
                name: it.name,
                quantity: it.quantity,
                optionId: it.optionId,
                listingId: it.listingId,
                skuMappings: it.skuMappings,
                fulfillments: { create: it.fulfillments },
              })),
            },
          },
        })
      }
    },
    { timeout: 60_000 }
  )

  const outbound = await recomputeNbaesongOutbound({
    spaceId,
    storeKey,
    channelId,
    locationId,
    dayKst,
  })
  return {
    orders: groups.size,
    items: Array.from(groups.values()).reduce((n, g) => n + g.items.length, 0),
    unmatched,
    skippedExisting,
    outbound,
  }
}

export async function recomputeNbaesongOutbound(p: {
  spaceId: string
  storeKey: string
  channelId: string
  locationId: string
  dayKst: string
}): Promise<Tally> {
  const { spaceId, storeKey, channelId, locationId, dayKst } = p
  const items = await prisma.delOrderItem.findMany({
    where: {
      order: {
        spaceId,
        channelId,
        batch: { source: 'NAVER_API', label: nbaesongBatchLabel(storeKey, dayKst) },
      },
    },
    select: {
      optionId: true,
      quantity: true,
      fulfillments: { select: { optionId: true, quantity: true } },
    },
  })
  const sums = new Map<string, number>()
  const add = (optionId: string, q: number) => sums.set(optionId, (sums.get(optionId) ?? 0) + q)
  for (const it of items) {
    if (it.fulfillments.length > 0) it.fulfillments.forEach((f) => add(f.optionId, f.quantity))
    else if (it.optionId) add(it.optionId, it.quantity)
  }

  const movementDate = new Date(`${dayKst}T00:00:00+09:00`)
  const tally: Tally = { created: 0, updated: 0, skipped: 0 }
  const apply = async (optionId: string, quantity: number) => {
    tally[
      await upsertOutboundMovement({
        spaceId,
        optionId,
        locationId,
        channelId,
        quantity,
        movementDate,
        referenceId: nbaesongReferenceId(storeKey, dayKst, optionId),
      })
    ]++
  }
  for (const [optionId, q] of sums) await apply(optionId, q)

  // 더 이상 합계에 없는 옵션(취소 등)의 기존 OUTBOUND 는 0 으로 정정해 재고 복원
  const stale = await prisma.invMovement.findMany({
    where: {
      spaceId,
      type: 'OUTBOUND',
      referenceId: { startsWith: `naver-nb:${storeKey}:${dayKst}:` },
    },
    select: { optionId: true },
  })
  for (const m of stale) if (!sums.has(m.optionId)) await apply(m.optionId, 0)
  return tally
}
