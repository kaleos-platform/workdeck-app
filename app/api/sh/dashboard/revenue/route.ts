import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { isYmdDateString } from '@/lib/date-range'
import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { loadRocketDailyRevenue, sumRocketDaily } from '@/lib/sh/rocket-revenue'

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

  // YYYY-MM-DD 형식 사전 검증 (Invalid Date 생성 방지)
  if (!isYmdDateString(fromParam) || !isYmdDateString(toParam)) {
    return errorResponse('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)', 400)
  }

  // KST 경계로 파싱: from = 해당일 00:00:00 KST, to = 해당일 23:59:59 KST
  const from = new Date(fromParam + 'T00:00:00+09:00')
  const to = new Date(toParam + 'T23:59:59+09:00')

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
        entry.orderCount += agg.orderCount
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

  // 현재 기간 집계 (MTD 비교는 sales-summary 가 담당. 이 라우트는 차트·채널 분해용)
  // to가 23:59:59 KST이므로 ceil이 이미 포함 일수를 정확히 반환 — +1 불필요
  const currentPeriodDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
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
    const curr = sumRocketDaily(currRocket)
    const prev = sumRocketDaily(prevRocket)
    const ce = currentMap.get(rocketCh.id) ?? { orderCount: 0, totalRevenue: 0 }
    ce.orderCount += curr.orderCount
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
    // 로켓그로스도 주문건수를 별도 수집(orderCount)하므로 일반 채널과 동일하게 취급.
    // 판매량(salesQty)은 재고 차감 전용이라 이 API 의 주문 집계와 무관.
    const avgOrder = curr.orderCount > 0 ? Math.round(curr.totalRevenue / curr.orderCount) : 0

    // 전월 대비 변화율 (이전 기간 매출이 0이면 null)
    const momChange =
      prev.totalRevenue > 0
        ? Math.round(((curr.totalRevenue - prev.totalRevenue) / prev.totalRevenue) * 10000) / 100
        : null

    totalOrderCount += curr.orderCount
    totalRevenue += curr.totalRevenue

    return {
      channelId: channel.id,
      channelName: channel.name,
      orderCount: curr.orderCount,
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
