import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const channelIdsParam = searchParams.get('channelIds')
  const groupBy = searchParams.get('groupBy') // 'date' | 'channel' | null (default: channel)

  if (!fromParam || !toParam) {
    return errorResponse('from, to 쿼리 파라미터가 필요합니다', 400)
  }

  const from = new Date(fromParam)
  const to = new Date(toParam)
  // to는 해당 날짜 끝까지 포함
  to.setHours(23, 59, 59, 999)

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return errorResponse('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)', 400)
  }
  if (from > to) {
    return errorResponse('from이 to보다 이후일 수 없습니다', 400)
  }

  // 채널 ID 필터 파싱
  const channelIds = channelIdsParam
    ? channelIdsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined

  // 채널 목록 조회 (필터 또는 전체)
  const channels = await prisma.channel.findMany({
    where: {
      spaceId: resolved.space.id,
      ...(channelIds && channelIds.length > 0 ? { id: { in: channelIds } } : {}),
      isActive: true,
    },
    select: { id: true, name: true, externalSource: true },
    orderBy: { name: 'asc' },
  })

  if (channels.length === 0) {
    return NextResponse.json({
      period: { from: fromParam, to: toParam },
      rows: [],
      totals: { orderCount: 0, totalRevenue: 0, avgOrder: 0 },
    })
  }

  const targetChannelIds = channels.map((c) => c.id)

  // ───── groupBy=date: 날짜별 × 채널별 집계 (차트용) ────────────────────────
  if (groupBy === 'date') {
    const dateOrders = await prisma.delOrder.findMany({
      where: {
        spaceId: resolved.space.id,
        channelId: { in: targetChannelIds },
        orderDate: { gte: from, lte: to },
      },
      select: {
        channelId: true,
        orderDate: true,
        paymentAmount: true,
      },
    })

    const channelNameById = new Map(channels.map((c) => [c.id, c.name]))
    type DateKey = string // YYYY-MM-DD (KST)
    const keyMap = new Map<
      string,
      {
        date: DateKey
        channelId: string
        channelName: string
        totalRevenue: number
        orderCount: number
      }
    >()

    for (const order of dateOrders) {
      if (!order.channelId || !order.orderDate) continue
      // KST 기준으로 YYYY-MM-DD 계산 (UTC+9)
      const kstMs = order.orderDate.getTime() + 9 * 60 * 60 * 1000
      const date = new Date(kstMs).toISOString().slice(0, 10)
      const key = `${date}|${order.channelId}`
      const entry = keyMap.get(key) ?? {
        date,
        channelId: order.channelId,
        channelName: channelNameById.get(order.channelId) ?? '',
        totalRevenue: 0,
        orderCount: 0,
      }
      entry.orderCount += 1
      entry.totalRevenue += Number(order.paymentAmount ?? 0)
      keyMap.set(key, entry)
    }

    // 로켓그로스 채널: DelOrder 가 없으므로 VENDOR 일자별 매출·수량을 행에 합산.
    const rocketCh = channels.find(
      (c) => c.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH
    )
    if (rocketCh) {
      const rocketDaily = await loadRocketDailyRevenue(resolved.space.id, from, to)
      for (const [date, agg] of rocketDaily) {
        const key = `${date}|${rocketCh.id}`
        const entry = keyMap.get(key) ?? {
          date,
          channelId: rocketCh.id,
          channelName: rocketCh.name,
          totalRevenue: 0,
          orderCount: 0,
        }
        entry.totalRevenue += agg.revenue
        entry.orderCount += agg.qty
        keyMap.set(key, entry)
      }
    }

    const rows = Array.from(keyMap.values())
      .map((r) => ({ ...r, totalRevenue: Math.round(r.totalRevenue) }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return NextResponse.json({
      period: { from: fromParam, to: toParam },
      rows,
    })
  }

  // 현재 기간 집계
  const currentPeriodDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1
  const prevFrom = new Date(from)
  prevFrom.setDate(prevFrom.getDate() - currentPeriodDays)
  const prevTo = new Date(to)
  prevTo.setDate(prevTo.getDate() - currentPeriodDays)

  // 현재 기간과 이전 기간을 병렬로 집계
  const [currentOrders, prevOrders] = await Promise.all([
    prisma.delOrder.findMany({
      where: {
        spaceId: resolved.space.id,
        channelId: { in: targetChannelIds },
        orderDate: { gte: from, lte: to },
      },
      select: {
        channelId: true,
        paymentAmount: true,
      },
    }),
    prisma.delOrder.findMany({
      where: {
        spaceId: resolved.space.id,
        channelId: { in: targetChannelIds },
        orderDate: { gte: prevFrom, lte: prevTo },
      },
      select: {
        channelId: true,
        paymentAmount: true,
      },
    }),
  ])

  // 채널별로 집계
  const currentMap = new Map<string, { orderCount: number; totalRevenue: number }>()
  const prevMap = new Map<string, { totalRevenue: number }>()

  for (const order of currentOrders) {
    if (!order.channelId) continue
    const entry = currentMap.get(order.channelId) ?? { orderCount: 0, totalRevenue: 0 }
    entry.orderCount += 1
    entry.totalRevenue += Number(order.paymentAmount ?? 0)
    currentMap.set(order.channelId, entry)
  }

  for (const order of prevOrders) {
    if (!order.channelId) continue
    const entry = prevMap.get(order.channelId) ?? { totalRevenue: 0 }
    entry.totalRevenue += Number(order.paymentAmount ?? 0)
    prevMap.set(order.channelId, entry)
  }

  // 로켓그로스 채널: DelOrder 가 없으므로 VENDOR 매출·수량을 현재·이전 기간에 합산.
  const rocketCh = channels.find((c) => c.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH)
  if (rocketCh) {
    const [currRocket, prevRocket] = await Promise.all([
      loadRocketDailyRevenue(resolved.space.id, from, to),
      loadRocketDailyRevenue(resolved.space.id, prevFrom, prevTo),
    ])
    const sumRocket = (m: Map<string, { revenue: number; qty: number }>) => {
      let revenue = 0
      let qty = 0
      for (const v of m.values()) {
        revenue += v.revenue
        qty += v.qty
      }
      return { revenue, qty }
    }
    const curr = sumRocket(currRocket)
    const prev = sumRocket(prevRocket)
    const ce = currentMap.get(rocketCh.id) ?? { orderCount: 0, totalRevenue: 0 }
    ce.orderCount += curr.qty
    ce.totalRevenue += curr.revenue
    currentMap.set(rocketCh.id, ce)
    const pe = prevMap.get(rocketCh.id) ?? { totalRevenue: 0 }
    pe.totalRevenue += prev.revenue
    prevMap.set(rocketCh.id, pe)
  }

  let totalOrderCount = 0
  let totalRevenue = 0

  const rows = channels.map((channel) => {
    const curr = currentMap.get(channel.id) ?? { orderCount: 0, totalRevenue: 0 }
    const prev = prevMap.get(channel.id) ?? { totalRevenue: 0 }
    // 로켓그로스는 주문수 컬럼이 없어 orderCount = 판매 "수량"(units) proxy 다.
    // 객단가(avgOrder)·totals 주문수는 "주문" 단위라 의미가 다르므로 로켓은 제외해
    // 혼합 평균 오염을 막는다. 매출은 정상 합산.
    const isRocketUnits = channel.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH
    const avgOrder =
      !isRocketUnits && curr.orderCount > 0 ? Math.round(curr.totalRevenue / curr.orderCount) : 0

    // 전월 대비 변화율 (이전 기간 매출이 0이면 null)
    const momChange =
      prev.totalRevenue > 0
        ? Math.round(((curr.totalRevenue - prev.totalRevenue) / prev.totalRevenue) * 10000) / 100
        : null

    if (!isRocketUnits) totalOrderCount += curr.orderCount
    totalRevenue += curr.totalRevenue

    return {
      channelId: channel.id,
      channelName: channel.name,
      orderCount: curr.orderCount,
      // 로켓: orderCount 는 판매 수량(units)이라 객단가 비계산.
      isUnitCount: isRocketUnits,
      totalRevenue: Math.round(curr.totalRevenue),
      avgOrder,
      prevRevenue: Math.round(prev.totalRevenue),
      momChange,
    }
  })

  const totalsAvgOrder = totalOrderCount > 0 ? Math.round(totalRevenue / totalOrderCount) : 0

  return NextResponse.json({
    period: { from: fromParam, to: toParam },
    rows,
    totals: {
      orderCount: totalOrderCount,
      totalRevenue: Math.round(totalRevenue),
      avgOrder: totalsAvgOrder,
    },
  })
}

/** Date 를 KST 일자 YYYY-MM-DD 로. (UTC instant → +9h → 날짜부) */
function toKstDateKey(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 로켓그로스 채널의 VENDOR 기반 매출·수량을 일자별로 집계한다.
 * 로켓그로스는 DelOrder 가 없어 paymentAmount 로 안 잡히므로, workspace VENDOR
 * (fileType=VENDOR_ITEM_METRICS, fulfillmentType=로켓그로스, 1일 export)에서
 * revenue30d(매출원)·salesQty30d(판매량=수량 proxy)를 snapshotDate 기준으로 합산.
 *
 * snapshotDate 는 KST 자정 instant(UTC 전날 15:00)로 저장된다. from/to(UTC instant)를
 * 그대로 비교하면 경계 일자가 누락되므로, KST 일자 경계로 정규화해 조회한다.
 *
 * @returns Map<YYYY-MM-DD(KST), { revenue, qty }> — 로켓 미연동이면 빈 Map.
 */
async function loadRocketDailyRevenue(
  spaceId: string,
  from: Date,
  to: Date
): Promise<Map<string, { revenue: number; qty: number }>> {
  const out = new Map<string, { revenue: number; qty: number }>()
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
    select: { snapshotDate: true, revenue30d: true, salesQty30d: true },
  })

  for (const r of records) {
    const date = toKstDateKey(r.snapshotDate)
    const entry = out.get(date) ?? { revenue: 0, qty: 0 }
    entry.revenue += Number(r.revenue30d ?? 0)
    entry.qty += r.salesQty30d ?? 0
    out.set(date, entry)
  }
  return out
}
