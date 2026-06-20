// 로켓그로스 채널의 VENDOR 기반 매출·주문·수량 일자별 집계.
//
// 로켓그로스는 DelOrder 가 없어 paymentAmount 로 안 잡히므로, workspace VENDOR
// (fileType=VENDOR_ITEM_METRICS, fulfillmentType=로켓그로스, 1일 export)에서
// revenue30d(매출원)·salesQty30d(판매량=수량 proxy)·orderCount(주문건수)를
// snapshotDate 기준으로 합산한다.
//
// snapshotDate 는 KST 자정 instant(UTC 전날 15:00)로 저장된다. from/to(UTC instant)를
// 그대로 비교하면 경계 일자가 누락되므로, KST 일자 경계로 정규화해 조회한다.
//
// dashboard/revenue 와 dashboard/sales-summary 가 공유한다 → 두 화면이 동일 정의.

import { prisma } from '@/lib/prisma'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'

/** Date 를 KST 일자 YYYY-MM-DD 로. (UTC instant → +9h → 날짜부) */
function toKstDateKey(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export type RocketDailyAgg = { revenue: number; orderCount: number; qty: number }

/**
 * 로켓그로스 VENDOR 매출·주문·수량을 일자별로 집계한다.
 *
 * @returns Map<YYYY-MM-DD(KST), { revenue, orderCount, qty }> — 로켓 미연동이면 빈 Map.
 */
export async function loadRocketDailyRevenue(
  spaceId: string,
  from: Date,
  to: Date
): Promise<Map<string, RocketDailyAgg>> {
  const out = new Map<string, RocketDailyAgg>()
  const resolved = await resolveCoupangWorkspaceForSpace(spaceId)
  if (!resolved) return out

  // from/to 의 KST 일자를 KST 자정 instant 범위로 (snapshotDate 저장 형식과 정렬).
  const gte = new Date(`${toKstDateKey(from)}T00:00:00+09:00`)
  const ltExclusive = new Date(`${toKstDateKey(to)}T00:00:00+09:00`)
  ltExclusive.setTime(ltExclusive.getTime() + 24 * 60 * 60 * 1000) // to 일자 포함

  const records = await prisma.inventoryRecord.findMany({
    where: {
      workspaceId: resolved.workspaceId,
      fileType: 'VENDOR_ITEM_METRICS',
      fulfillmentType: '로켓그로스',
      snapshotDate: { gte, lt: ltExclusive },
    },
    select: { snapshotDate: true, revenue30d: true, salesQty30d: true, orderCount: true },
  })

  for (const r of records) {
    const date = toKstDateKey(r.snapshotDate)
    const entry = out.get(date) ?? { revenue: 0, orderCount: 0, qty: 0 }
    entry.revenue += Number(r.revenue30d ?? 0)
    entry.orderCount += r.orderCount ?? 0 // 주문건수 (별도 수집) — 판매분석은 주문 기준
    entry.qty += r.salesQty30d ?? 0 // 판매량 — 재고 차감 전용
    out.set(date, entry)
  }
  return out
}

/** Map 전체를 단일 합계로 축약. */
export function sumRocketDaily(m: Map<string, RocketDailyAgg>): RocketDailyAgg {
  let revenue = 0
  let orderCount = 0
  let qty = 0
  for (const v of m.values()) {
    revenue += v.revenue
    orderCount += v.orderCount
    qty += v.qty
  }
  return { revenue, orderCount, qty }
}
