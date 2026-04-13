import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { calculateROAS } from '@/lib/metrics-calculator'
import { parsePureProductName } from '@/lib/product-name-parser'

type Params = { params: Promise<{ campaignId: string }> }

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
    // from/to 파라미터가 있으면 해당 기간 사용
    currentStart = new Date(fromParam)
    currentStart.setHours(0, 0, 0, 0)
    currentEnd = new Date(toParam)
    currentEnd.setHours(23, 59, 59, 999)
  } else {
    // fallback: period 파라미터
    const period = Math.min(90, Math.max(1, Number(searchParams.get('period') ?? 7)))
    const now = new Date()
    currentEnd = new Date(now)
    currentEnd.setHours(23, 59, 59, 999)
    currentStart = new Date(now)
    currentStart.setDate(currentStart.getDate() - period + 1)
    currentStart.setHours(0, 0, 0, 0)
  }

  // 현재 기간 길이만큼 이전 기간 계산
  const periodMs = currentEnd.getTime() - currentStart.getTime()
  const periodDays = Math.round(periodMs / (1000 * 60 * 60 * 24)) + 1

  // 이전 기간: currentStart - periodDays ~ currentStart - 1
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

  const [currentData, previousData] = await Promise.all([
    prisma.adRecord.groupBy({
      by: ['productName'],
      where: { ...baseWhere, date: { gte: currentStart, lte: currentEnd } },
      _sum: { orders1d: true, revenue1d: true, adCost: true },
    }),
    prisma.adRecord.groupBy({
      by: ['productName'],
      where: { ...baseWhere, date: { gte: previousStart, lte: previousEnd } },
      _sum: { orders1d: true, revenue1d: true, adCost: true },
    }),
  ])

  // 이전 기간 맵
  const prevMap = new Map<string, { orders: number; revenue: number; adCost: number }>()
  for (const g of previousData) {
    const key = `${g.productName ?? ''}`
    prevMap.set(key, {
      orders: Number(g._sum.orders1d ?? 0),
      revenue: Number(g._sum.revenue1d ?? 0),
      adCost: Number(g._sum.adCost ?? 0),
    })
  }

  // 현재 기간 처리
  const seenKeys = new Set<string>()
  type TrendItem = {
    productName: string
    current: { orders: number; revenue: number; adCost: number; roas: number | null }
    previous: { orders: number; revenue: number; adCost: number; roas: number | null }
    ordersChange: number
    ordersChangePct: number | null
    revenueChange: number
    revenueChangePct: number | null
    trend: 'up' | 'down' | 'stable' | 'new' | 'gone'
  }

  const trends: TrendItem[] = []

  for (const g of currentData) {
    const key = `${g.productName ?? ''}`
    seenKeys.add(key)

    const curOrders = Number(g._sum.orders1d ?? 0)
    const curRevenue = Number(g._sum.revenue1d ?? 0)
    const curAdCost = Number(g._sum.adCost ?? 0)
    const prev = prevMap.get(key)

    const prevOrders = prev?.orders ?? 0
    const prevRevenue = prev?.revenue ?? 0
    const prevAdCost = prev?.adCost ?? 0

    const ordersChange = curOrders - prevOrders
    const ordersChangePct = prevOrders > 0
      ? Math.round((ordersChange / prevOrders) * 1000) / 10
      : null
    const revenueChange = curRevenue - prevRevenue
    const revenueChangePct = prevRevenue > 0
      ? Math.round((revenueChange / prevRevenue) * 1000) / 10
      : null

    let trend: TrendItem['trend'] = 'stable'
    if (!prev && (curOrders > 0 || curRevenue > 0)) trend = 'new'
    else if (ordersChangePct != null && ordersChangePct > 10) trend = 'up'
    else if (ordersChangePct != null && ordersChangePct < -10) trend = 'down'

    trends.push({
      productName: parsePureProductName(g.productName),
      current: { orders: curOrders, revenue: curRevenue, adCost: curAdCost, roas: calculateROAS(curRevenue, curAdCost) },
      previous: { orders: prevOrders, revenue: prevRevenue, adCost: prevAdCost, roas: calculateROAS(prevRevenue, prevAdCost) },
      ordersChange,
      ordersChangePct,
      revenueChange,
      revenueChangePct,
      trend,
    })
  }

  // 이전에만 있던 상품 (gone)
  for (const g of previousData) {
    const key = `${g.productName ?? ''}`
    if (seenKeys.has(key)) continue

    const prevOrders = Number(g._sum.orders1d ?? 0)
    const prevRevenue = Number(g._sum.revenue1d ?? 0)
    const prevAdCost = Number(g._sum.adCost ?? 0)
    if (prevOrders === 0 && prevRevenue === 0) continue

    trends.push({
      productName: parsePureProductName(g.productName),
      current: { orders: 0, revenue: 0, adCost: 0, roas: null },
      previous: { orders: prevOrders, revenue: prevRevenue, adCost: prevAdCost, roas: calculateROAS(prevRevenue, prevAdCost) },
      ordersChange: -prevOrders,
      ordersChangePct: -100,
      revenueChange: -prevRevenue,
      revenueChangePct: -100,
      trend: 'gone',
    })
  }

  // 변화량 절대값 기준 정렬 (큰 변화 먼저), 최대 100개
  trends.sort((a, b) => Math.abs(b.ordersChange) - Math.abs(a.ordersChange))
  const limited = trends.slice(0, 100)

  return NextResponse.json({
    trends: limited,
    period: periodDays,
    currentRange: { start: currentStart.toISOString(), end: currentEnd.toISOString() },
    previousRange: { start: previousStart.toISOString(), end: previousEnd.toISOString() },
  })
}
