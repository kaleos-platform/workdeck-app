// 분석 데이터 빌더 — Prisma에서 데이터를 조회하여 AI 분석 입력 형태로 가공

import { prisma } from '@/lib/prisma'
import { calculateCTR, calculateCVR, calculateROAS } from '@/lib/metrics-calculator'
import type { AnalysisInput, CampaignSummary, InefficientKeyword } from '@/lib/ai/analyzer'
import type { AnalysisType } from '@/generated/prisma/client'

/**
 * 워크스페이스의 광고 데이터를 분석 컨텍스트로 빌드
 */
export async function buildAnalysisContext(
  workspaceId: string,
  startDate: Date,
  endDate: Date,
  reportType: AnalysisType = 'DAILY_REVIEW'
): Promise<AnalysisInput> {
  // 캠페인별 집계
  const campaignGroups = await prisma.adRecord.groupBy({
    by: ['campaignId', 'campaignName'],
    where: {
      workspaceId,
      date: { gte: startDate, lte: endDate },
    },
    _sum: {
      adCost: true,
      impressions: true,
      clicks: true,
      orders1d: true,
      revenue1d: true,
    },
    orderBy: { _sum: { adCost: 'desc' } },
  })

  const campaigns: CampaignSummary[] = campaignGroups.map((g) => {
    const totalAdCost = Number(g._sum.adCost ?? 0)
    const totalImpressions = Number(g._sum.impressions ?? 0)
    const totalClicks = Number(g._sum.clicks ?? 0)
    const totalOrders = Number(g._sum.orders1d ?? 0)
    const totalRevenue = Number(g._sum.revenue1d ?? 0)

    return {
      campaignId: g.campaignId,
      campaignName: g.campaignName,
      totalAdCost,
      totalImpressions,
      totalClicks,
      totalOrders,
      totalRevenue,
      ctr: calculateCTR(totalClicks, totalImpressions),
      cvr: calculateCVR(totalOrders, totalClicks),
      roas: calculateROAS(totalRevenue, totalAdCost),
    }
  })

  // 비효율 키워드 식별 (광고비 > 0, 주문 = 0)
  const keywordGroups = await prisma.adRecord.groupBy({
    by: ['campaignId', 'campaignName', 'keyword'],
    where: {
      workspaceId,
      date: { gte: startDate, lte: endDate },
      keyword: { not: null },
    },
    _sum: {
      adCost: true,
      impressions: true,
      clicks: true,
      orders1d: true,
    },
    orderBy: { _sum: { adCost: 'desc' } },
  })

  const inefficientKeywords: InefficientKeyword[] = keywordGroups
    .filter((g) => {
      const adCost = Number(g._sum.adCost ?? 0)
      const orders = Number(g._sum.orders1d ?? 0)
      return adCost > 0 && orders === 0
    })
    .map((g) => ({
      campaignId: g.campaignId,
      campaignName: g.campaignName,
      keyword: g.keyword!,
      adCost: Number(g._sum.adCost ?? 0),
      clicks: Number(g._sum.clicks ?? 0),
      impressions: Number(g._sum.impressions ?? 0),
      orders: 0,
    }))

  return {
    reportType,
    periodStart: startDate.toISOString().split('T')[0],
    periodEnd: endDate.toISOString().split('T')[0],
    campaigns,
    inefficientKeywords,
  }
}
