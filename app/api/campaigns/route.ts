import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'

// GET /api/campaigns — 워크스페이스 내 캠페인 목록 (displayName 포함)
// startDate, endDate 파라미터 제공 시 캠페인별 기간 지표 + 이전 동일 기간 지표 포함
export async function GET(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  // 캠페인 ID별 distinct 조회
  const rows = await prisma.adRecord.findMany({
    where: { workspaceId: workspace.id },
    select: {
      campaignId: true,
      campaignName: true,
      adType: true,
    },
    distinct: ['campaignId', 'adType'],
    orderBy: { campaignId: 'asc' },
  })

  // CampaignMeta 조회 (displayName, isCustomName)
  const metas = await prisma.campaignMeta.findMany({
    where: { workspaceId: workspace.id },
    select: { campaignId: true, displayName: true, isCustomName: true },
  })
  const metaMap = new Map(metas.map((m) => [m.campaignId, m]))

  // campaignId별 그룹화
  const campaignMap = new Map<
    string,
    { id: string; name: string; displayName: string; isCustomName: boolean; adTypes: string[] }
  >()
  for (const row of rows) {
    if (!campaignMap.has(row.campaignId)) {
      const meta = metaMap.get(row.campaignId)
      campaignMap.set(row.campaignId, {
        id: row.campaignId,
        name: row.campaignName,
        displayName: meta?.displayName ?? row.campaignName,
        isCustomName: meta?.isCustomName ?? false,
        adTypes: [],
      })
    }
    const campaign = campaignMap.get(row.campaignId)!
    if (!campaign.adTypes.includes(row.adType)) {
      campaign.adTypes.push(row.adType)
    }
  }

  const campaigns = Array.from(campaignMap.values())

  // 각 캠페인의 현재 유효한 CampaignTarget (effectiveDate <= now, 가장 최근 1건)
  const allTargets = await prisma.campaignTarget.findMany({
    where: {
      workspaceId: workspace.id,
      effectiveDate: { lte: new Date() },
    },
    orderBy: { effectiveDate: 'desc' },
    select: { campaignId: true, dailyBudget: true, targetRoas: true },
  })
  const targetMap = new Map<string, { dailyBudget: number | null; targetRoas: number | null }>()
  for (const t of allTargets) {
    if (!targetMap.has(t.campaignId)) {
      targetMap.set(t.campaignId, { dailyBudget: t.dailyBudget, targetRoas: t.targetRoas })
    }
  }

  // startDate, endDate 제공 시 캠페인별 기간 지표 포함
  const { searchParams } = request.nextUrl
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  if (startDate && endDate) {
    const startObj = new Date(startDate + 'T00:00:00+09:00')
    const endObj = new Date(endDate + 'T23:59:59+09:00')

    // 이전 동일 기간 계산 (현재 기간과 동일 일수)
    const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1
    const prevEndDate = new Date(Date.parse(startDate) - 86400000).toISOString().split('T')[0]
    const prevStartDate = new Date(Date.parse(startDate) - days * 86400000)
      .toISOString()
      .split('T')[0]
    const prevStartObj = new Date(prevStartDate + 'T00:00:00+09:00')
    const prevEndObj = new Date(prevEndDate + 'T23:59:59+09:00')

    // 현재 기간 캠페인별 집계
    const currentAgg = await prisma.adRecord.groupBy({
      by: ['campaignId'],
      where: { workspaceId: workspace.id, date: { gte: startObj, lte: endObj } },
      _sum: { adCost: true, revenue1d: true },
    })

    // 이전 기간 캠페인별 집계
    const prevAgg = await prisma.adRecord.groupBy({
      by: ['campaignId'],
      where: { workspaceId: workspace.id, date: { gte: prevStartObj, lte: prevEndObj } },
      _sum: { adCost: true, revenue1d: true },
    })

    type AggRow = { campaignId: string; _sum: { adCost: unknown; revenue1d: unknown } }
    const currentMap = new Map((currentAgg as AggRow[]).map((a) => [a.campaignId, a]))
    const prevMap = new Map((prevAgg as AggRow[]).map((a) => [a.campaignId, a]))

    const enriched = campaigns.map((c) => {
      const curr = currentMap.get(c.id)
      const prev = prevMap.get(c.id)

      const totalAdCost = Number(curr?._sum.adCost ?? 0)
      const totalRevenue = Number(curr?._sum.revenue1d ?? 0)
      const avgRoas = totalAdCost > 0 ? (totalRevenue / totalAdCost) * 100 : null

      const prevAdCost = Number(prev?._sum.adCost ?? 0)
      const prevRevenue = Number(prev?._sum.revenue1d ?? 0)
      const prevRoas = prevAdCost > 0 ? (prevRevenue / prevAdCost) * 100 : null

      const ct = targetMap.get(c.id) ?? null
      return {
        ...c,
        metrics: { totalAdCost, totalRevenue, avgRoas },
        prevMetrics: prev
          ? { totalAdCost: prevAdCost, totalRevenue: prevRevenue, avgRoas: prevRoas }
          : null,
        currentTarget: ct,
      }
    })

    return NextResponse.json(enriched)
  }

  return NextResponse.json(
    campaigns.map((c) => ({ ...c, currentTarget: targetMap.get(c.id) ?? null }))
  )
}
