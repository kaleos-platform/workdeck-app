import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const channelIdsParam = searchParams.get('channelIds')

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
    select: { id: true, name: true },
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

  let totalOrderCount = 0
  let totalRevenue = 0

  const rows = channels.map((channel) => {
    const curr = currentMap.get(channel.id) ?? { orderCount: 0, totalRevenue: 0 }
    const prev = prevMap.get(channel.id) ?? { totalRevenue: 0 }
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
