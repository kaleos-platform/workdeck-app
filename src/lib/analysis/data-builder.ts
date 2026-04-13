// 분석 데이터 빌더 — Prisma에서 데이터를 조회하여 AI 분석 입력 형태로 가공

import { prisma } from '@/lib/prisma'
import { calculateCTR, calculateCVR, calculateROAS } from '@/lib/metrics-calculator'
import type { AnalysisInput, CampaignSummary, InefficientKeyword } from '@/lib/ai/suggestion-types'
import type { AnalysisType } from '@/generated/prisma/client'

// 제거된 키워드 히스토리
export interface RemovedKeyword {
  campaignId: string
  keyword: string
  removedAt: Date
  removedMemo: string | null
}

// 제거된 상품 히스토리
export interface RemovedProduct {
  campaignId: string
  productName: string
  optionId: string
  removedAt: Date
}

// 캠페인 목표 설정
export interface CampaignTargetInfo {
  campaignId: string
  dailyBudget: number | null
  targetRoas: number | null
  effectiveDate: Date
}

// 일별 메모
export interface DailyMemoInfo {
  campaignId: string
  date: Date
  content: string
}

// 캠페인 표시명
export interface CampaignMetaInfo {
  campaignId: string
  displayName: string
}

// 분석 규칙
export interface ActiveRule {
  id: string
  rule: string
  source: string
}

// 확장된 분석 컨텍스트
export interface AnalysisContext extends AnalysisInput {
  removedKeywords: RemovedKeyword[]
  removedProducts: RemovedProduct[]
  campaignTargets: CampaignTargetInfo[]
  recentMemos: DailyMemoInfo[]
  campaignMetas: CampaignMetaInfo[]
  activeRules: ActiveRule[]
}

/**
 * 워크스페이스의 광고 데이터를 분석 컨텍스트로 빌드
 */
export async function buildAnalysisContext(
  workspaceId: string,
  startDate: Date,
  endDate: Date,
  reportType: AnalysisType = 'DAILY_REVIEW'
): Promise<AnalysisContext> {
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

  // 캠페인별 총 광고비 맵 (costRatio 계산용)
  const campaignAdCostMap = new Map<string, number>()
  for (const c of campaigns) {
    campaignAdCostMap.set(c.campaignId, c.totalAdCost)
  }

  const inefficientKeywords: InefficientKeyword[] = keywordGroups
    .filter((g) => {
      const adCost = Number(g._sum.adCost ?? 0)
      const orders = Number(g._sum.orders1d ?? 0)
      return adCost > 0 && orders === 0
    })
    .map((g) => {
      const adCost = Number(g._sum.adCost ?? 0)
      const campaignTotal = campaignAdCostMap.get(g.campaignId) ?? 0
      const costRatio = campaignTotal > 0
        ? Math.round((adCost / campaignTotal) * 10000) / 100  // 소수점 2자리 %
        : 0
      return {
        campaignId: g.campaignId,
        campaignName: g.campaignName,
        keyword: g.keyword!,
        adCost,
        clicks: Number(g._sum.clicks ?? 0),
        impressions: Number(g._sum.impressions ?? 0),
        orders: 0,
        costRatio,
      }
    })

  // 제거된 키워드 히스토리
  const removedKeywordsRaw = await prisma.keywordStatus.findMany({
    where: { workspaceId, removedAt: { not: null } },
    select: { campaignId: true, keyword: true, removedAt: true, removedMemo: true },
    orderBy: { removedAt: 'desc' },
  })
  const removedKeywords: RemovedKeyword[] = removedKeywordsRaw.map((k) => ({
    campaignId: k.campaignId,
    keyword: k.keyword,
    removedAt: k.removedAt!,
    removedMemo: k.removedMemo,
  }))

  // 제거된 상품 히스토리
  const removedProductsRaw = await prisma.productStatus.findMany({
    where: { workspaceId, removedAt: { not: null } },
    select: { campaignId: true, productName: true, optionId: true, removedAt: true },
    orderBy: { removedAt: 'desc' },
  })
  const removedProducts: RemovedProduct[] = removedProductsRaw.map((p) => ({
    campaignId: p.campaignId,
    productName: p.productName,
    optionId: p.optionId,
    removedAt: p.removedAt!,
  }))

  // 캠페인별 목표 설정 (최신 effectiveDate 기준)
  const campaignTargets = await prisma.campaignTarget.findMany({
    where: { workspaceId },
    select: { campaignId: true, dailyBudget: true, targetRoas: true, effectiveDate: true },
    orderBy: { effectiveDate: 'desc' },
  })

  // 최근 메모 (최근 30일)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const recentMemos = await prisma.dailyMemo.findMany({
    where: { workspaceId, date: { gte: thirtyDaysAgo } },
    select: { campaignId: true, date: true, content: true },
    orderBy: { date: 'desc' },
    take: 50,
  })

  // 캠페인 표시명
  const campaignMetas = await prisma.campaignMeta.findMany({
    where: { workspaceId },
    select: { campaignId: true, displayName: true },
  })

  // 활성 분석 규칙
  const activeRulesRaw = await prisma.analysisRule.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, rule: true, source: true },
    orderBy: { createdAt: 'asc' },
  })

  return {
    reportType,
    periodStart: startDate.toISOString().split('T')[0],
    periodEnd: endDate.toISOString().split('T')[0],
    campaigns,
    inefficientKeywords,
    removedKeywords,
    removedProducts,
    campaignTargets,
    recentMemos,
    campaignMetas,
    activeRules: activeRulesRaw,
  }
}
