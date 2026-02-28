import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// WoW(기간 대비) 증감율 계산 — 이전 값이 0이면 null
function calcWow(current: number, prev: number): number | null {
  if (prev === 0) return null
  return Math.round(((current - prev) / prev) * 1000) / 10
}

// GET /api/dashboard/kpi?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// 선택 기간 집계 KPI 5개 + 이전 동일 기간 대비 증감율 반환
export async function GET(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { searchParams } = request.nextUrl
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  if (!startDate || !endDate) {
    return errorResponse('startDate, endDate 파라미터가 필요합니다', 400)
  }

  const startObj = new Date(startDate + 'T00:00:00+09:00')
  const endObj = new Date(endDate + 'T23:59:59+09:00')

  // 이전 동일 기간 계산 (현재 기간과 동일 일수만큼 이전)
  const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1
  const prevEndDate = new Date(Date.parse(startDate) - 86400000).toISOString().split('T')[0]
  const prevStartDate = new Date(Date.parse(startDate) - days * 86400000)
    .toISOString()
    .split('T')[0]
  const prevStartObj = new Date(prevStartDate + 'T00:00:00+09:00')
  const prevEndObj = new Date(prevEndDate + 'T23:59:59+09:00')

  // 현재 기간 집계
  const currentAgg = await prisma.adRecord.aggregate({
    where: {
      workspaceId: workspace.id,
      date: { gte: startObj, lte: endObj },
    },
    _sum: { adCost: true, revenue1d: true, orders1d: true, clicks: true, impressions: true },
  })

  // 이전 기간 집계
  const prevAgg = await prisma.adRecord.aggregate({
    where: {
      workspaceId: workspace.id,
      date: { gte: prevStartObj, lte: prevEndObj },
    },
    _sum: { adCost: true, revenue1d: true, orders1d: true, clicks: true, impressions: true },
  })

  // 현재 수치
  const adCost = Number(currentAgg._sum.adCost ?? 0)
  const revenue = Number(currentAgg._sum.revenue1d ?? 0)
  const orders = Number(currentAgg._sum.orders1d ?? 0)
  const clicks = Number(currentAgg._sum.clicks ?? 0)
  const impressions = Number(currentAgg._sum.impressions ?? 0)

  // 이전 수치
  const prevAdCost = Number(prevAgg._sum.adCost ?? 0)
  const prevRevenue = Number(prevAgg._sum.revenue1d ?? 0)
  const prevOrders = Number(prevAgg._sum.orders1d ?? 0)
  const prevClicks = Number(prevAgg._sum.clicks ?? 0)
  const prevImpressions = Number(prevAgg._sum.impressions ?? 0)

  // KPI 계산
  const roas = adCost > 0 ? (revenue / adCost) * 100 : null
  const prevRoas = prevAdCost > 0 ? (prevRevenue / prevAdCost) * 100 : null
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : null
  const prevCtr = prevImpressions > 0 ? (prevClicks / prevImpressions) * 100 : null
  const cvr = clicks > 0 ? (orders / clicks) * 100 : null
  const prevCvr = prevClicks > 0 ? (prevOrders / prevClicks) * 100 : null

  return NextResponse.json({
    adCost,
    roas,
    revenue,
    ctr,
    cvr,
    prevAdCost,
    prevRoas,
    prevRevenue,
    prevCtr,
    prevCvr,
    wow: {
      adCost: calcWow(adCost, prevAdCost),
      roas: roas !== null && prevRoas !== null ? calcWow(roas, prevRoas) : null,
      revenue: calcWow(revenue, prevRevenue),
      ctr: ctr !== null && prevCtr !== null ? calcWow(ctr, prevCtr) : null,
      cvr: cvr !== null && prevCvr !== null ? calcWow(cvr, prevCvr) : null,
    },
  })
}
