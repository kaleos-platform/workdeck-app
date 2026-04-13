import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { calculateROAS } from '@/lib/metrics-calculator'
import { parsePureProductName, parseOptionName } from '@/lib/product-name-parser'

type Params = { params: Promise<{ campaignId: string }> }

type Stats = { orders: number; revenue: number; adCost: number }
type StatsWithRoas = Stats & { roas: number | null }
type Trend = 'up' | 'down' | 'stable' | 'new' | 'gone'

function calcChange(cur: number, prev: number) {
  const change = cur - prev
  const pct = prev > 0 ? Math.round((change / prev) * 1000) / 10 : null
  return { change, pct }
}

function calcTrend(prev: Stats | undefined, curOrders: number, curRevenue: number, ordersChangePct: number | null): Trend {
  if (!prev && (curOrders > 0 || curRevenue > 0)) return 'new'
  if (ordersChangePct != null && ordersChangePct > 10) return 'up'
  if (ordersChangePct != null && ordersChangePct < -10) return 'down'
  return 'stable'
}

export async function GET(req: NextRequest, { params }: Params) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error

  const { campaignId } = await params
  const { searchParams } = req.nextUrl
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  let currentStart: Date
  let currentEnd: Date

  if (fromParam && toParam) {
    currentStart = new Date(fromParam)
    currentStart.setHours(0, 0, 0, 0)
    currentEnd = new Date(toParam)
    currentEnd.setHours(23, 59, 59, 999)
  } else {
    const period = Math.min(90, Math.max(1, Number(searchParams.get('period') ?? 7)))
    const now = new Date()
    currentEnd = new Date(now)
    currentEnd.setHours(23, 59, 59, 999)
    currentStart = new Date(now)
    currentStart.setDate(currentStart.getDate() - period + 1)
    currentStart.setHours(0, 0, 0, 0)
  }

  const periodMs = currentEnd.getTime() - currentStart.getTime()
  const periodDays = Math.round(periodMs / (1000 * 60 * 60 * 24)) + 1

  const previousEnd = new Date(currentStart)
  previousEnd.setDate(previousEnd.getDate() - 1)
  previousEnd.setHours(23, 59, 59, 999)
  const previousStart = new Date(previousEnd)
  previousStart.setDate(previousStart.getDate() - periodDays + 1)
  previousStart.setHours(0, 0, 0, 0)

  const baseWhere = {
    workspaceId: resolved.workspace.id,
    campaignId,
    productName: { not: null },
  }

  // 옵션 단위로 조회
  const [currentData, previousData] = await Promise.all([
    prisma.adRecord.groupBy({
      by: ['productName', 'optionId'],
      where: { ...baseWhere, date: { gte: currentStart, lte: currentEnd } },
      _sum: { orders1d: true, revenue1d: true, adCost: true },
    }),
    prisma.adRecord.groupBy({
      by: ['productName', 'optionId'],
      where: { ...baseWhere, date: { gte: previousStart, lte: previousEnd } },
      _sum: { orders1d: true, revenue1d: true, adCost: true },
    }),
  ])

  // 이전 기간 맵 (옵션 단위)
  const prevMap = new Map<string, Stats>()
  for (const g of previousData) {
    const key = `${g.productName ?? ''}|${g.optionId ?? ''}`
    prevMap.set(key, {
      orders: Number(g._sum.orders1d ?? 0),
      revenue: Number(g._sum.revenue1d ?? 0),
      adCost: Number(g._sum.adCost ?? 0),
    })
  }

  // 옵션별 트렌드 계산 후 상품별로 그룹핑
  type OptionTrend = {
    optionName: string
    current: StatsWithRoas
    previous: StatsWithRoas
    ordersChange: number
    ordersChangePct: number | null
    revenueChange: number
    revenueChangePct: number | null
    trend: Trend
  }

  // 상품별 집계용 맵
  const productMap = new Map<string, {
    curTotal: Stats
    prevTotal: Stats
    options: OptionTrend[]
    seenOptionKeys: Set<string>
  }>()

  function getOrCreate(pName: string) {
    if (!productMap.has(pName)) {
      productMap.set(pName, {
        curTotal: { orders: 0, revenue: 0, adCost: 0 },
        prevTotal: { orders: 0, revenue: 0, adCost: 0 },
        options: [],
        seenOptionKeys: new Set(),
      })
    }
    return productMap.get(pName)!
  }

  // 현재 기간 데이터 처리
  const seenKeys = new Set<string>()
  for (const g of currentData) {
    const rawKey = `${g.productName ?? ''}|${g.optionId ?? ''}`
    seenKeys.add(rawKey)

    const pName = parsePureProductName(g.productName)
    const optName = parseOptionName(g.productName) ?? g.optionId ?? '-'
    const curOrders = Number(g._sum.orders1d ?? 0)
    const curRevenue = Number(g._sum.revenue1d ?? 0)
    const curAdCost = Number(g._sum.adCost ?? 0)
    const prev = prevMap.get(rawKey)
    const prevOrders = prev?.orders ?? 0
    const prevRevenue = prev?.revenue ?? 0
    const prevAdCost = prev?.adCost ?? 0

    const orders = calcChange(curOrders, prevOrders)
    const revenue = calcChange(curRevenue, prevRevenue)

    const entry = getOrCreate(pName)
    entry.curTotal.orders += curOrders
    entry.curTotal.revenue += curRevenue
    entry.curTotal.adCost += curAdCost
    entry.prevTotal.orders += prevOrders
    entry.prevTotal.revenue += prevRevenue
    entry.prevTotal.adCost += prevAdCost
    entry.seenOptionKeys.add(rawKey)

    entry.options.push({
      optionName: optName,
      current: { orders: curOrders, revenue: curRevenue, adCost: curAdCost, roas: calculateROAS(curRevenue, curAdCost) },
      previous: { orders: prevOrders, revenue: prevRevenue, adCost: prevAdCost, roas: calculateROAS(prevRevenue, prevAdCost) },
      ordersChange: orders.change,
      ordersChangePct: orders.pct,
      revenueChange: revenue.change,
      revenueChangePct: revenue.pct,
      trend: calcTrend(prev, curOrders, curRevenue, orders.pct),
    })
  }

  // 이전에만 있던 옵션 (gone)
  for (const g of previousData) {
    const rawKey = `${g.productName ?? ''}|${g.optionId ?? ''}`
    if (seenKeys.has(rawKey)) continue

    const prevOrders = Number(g._sum.orders1d ?? 0)
    const prevRevenue = Number(g._sum.revenue1d ?? 0)
    const prevAdCost = Number(g._sum.adCost ?? 0)
    if (prevOrders === 0 && prevRevenue === 0) continue

    const pName = parsePureProductName(g.productName)
    const optName = parseOptionName(g.productName) ?? g.optionId ?? '-'

    const entry = getOrCreate(pName)
    entry.prevTotal.orders += prevOrders
    entry.prevTotal.revenue += prevRevenue
    entry.prevTotal.adCost += prevAdCost

    entry.options.push({
      optionName: optName,
      current: { orders: 0, revenue: 0, adCost: 0, roas: null },
      previous: { orders: prevOrders, revenue: prevRevenue, adCost: prevAdCost, roas: calculateROAS(prevRevenue, prevAdCost) },
      ordersChange: -prevOrders,
      ordersChangePct: -100,
      revenueChange: -prevRevenue,
      revenueChangePct: -100,
      trend: 'gone' as Trend,
    })
  }

  // 상품별 합계 트렌드 생성
  type ProductTrend = {
    productName: string
    current: StatsWithRoas
    previous: StatsWithRoas
    ordersChange: number
    ordersChangePct: number | null
    revenueChange: number
    revenueChangePct: number | null
    trend: Trend
    options: OptionTrend[]
  }

  const trends: ProductTrend[] = []
  for (const [pName, entry] of productMap) {
    const orders = calcChange(entry.curTotal.orders, entry.prevTotal.orders)
    const revenue = calcChange(entry.curTotal.revenue, entry.prevTotal.revenue)
    const hasPrev = entry.prevTotal.orders > 0 || entry.prevTotal.revenue > 0

    trends.push({
      productName: pName,
      current: { ...entry.curTotal, roas: calculateROAS(entry.curTotal.revenue, entry.curTotal.adCost) },
      previous: { ...entry.prevTotal, roas: calculateROAS(entry.prevTotal.revenue, entry.prevTotal.adCost) },
      ordersChange: orders.change,
      ordersChangePct: orders.pct,
      revenueChange: revenue.change,
      revenueChangePct: revenue.pct,
      trend: calcTrend(hasPrev ? entry.prevTotal : undefined, entry.curTotal.orders, entry.curTotal.revenue, orders.pct),
      options: entry.options.sort((a, b) => Math.abs(b.ordersChange) - Math.abs(a.ordersChange)),
    })
  }

  // 변화량 절대값 기준 정렬, 최대 100개
  trends.sort((a, b) => Math.abs(b.ordersChange) - Math.abs(a.ordersChange))
  const limited = trends.slice(0, 100)

  return NextResponse.json({
    trends: limited,
    period: periodDays,
    currentRange: { start: currentStart.toISOString(), end: currentEnd.toISOString() },
    previousRange: { start: previousStart.toISOString(), end: previousEnd.toISOString() },
  })
}
