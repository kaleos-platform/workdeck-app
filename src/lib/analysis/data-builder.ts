// 분석 데이터 빌더 — Prisma에서 데이터를 조회하여 AI 분석 입력 형태로 가공

import { prisma } from '@/lib/prisma'
import {
  calculateCTR,
  calculateCVR,
  calculateROAS,
  hasSignificantSample,
  MIN_SIGNIFICANT_CLICKS,
  MIN_SIGNIFICANT_IMPRESSIONS,
  MIN_SIGNIFICANT_ADCOST,
} from '@/lib/metrics-calculator'
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
  // 캠페인별 집계 — 전환(주문/매출)은 14일 우선(COALESCE), 없으면 1일.
  // 지연 전환을 반영해 ROAS 과소평가를 완화한다. Prisma groupBy는 per-row COALESCE 집계가
  // 불가하여 파라미터화된 raw SQL 사용(기존 데이터/NCA는 orders14d null → 1일로 폴백).
  const campaignGroups = await prisma.$queryRaw<
    Array<{
      campaignId: string
      campaignName: string
      adCost: number | string
      impressions: number | bigint
      clicks: number | bigint
      orders: number | bigint
      revenue: number | string
    }>
  >`
    SELECT "campaignId", "campaignName",
      SUM("adCost") AS "adCost",
      SUM("impressions") AS "impressions",
      SUM("clicks") AS "clicks",
      SUM(COALESCE("orders14d", "orders1d")) AS "orders",
      SUM(COALESCE("revenue14d", "revenue1d")) AS "revenue"
    FROM "AdRecord"
    WHERE "workspaceId" = ${workspaceId}
      AND "date" >= ${startDate}
      AND "date" <= ${endDate}
    GROUP BY "campaignId", "campaignName"
    ORDER BY SUM("adCost") DESC
  `

  const campaigns: CampaignSummary[] = campaignGroups.map((g) => {
    const totalAdCost = Number(g.adCost ?? 0)
    const totalImpressions = Number(g.impressions ?? 0)
    const totalClicks = Number(g.clicks ?? 0)
    const totalOrders = Number(g.orders ?? 0)
    const totalRevenue = Number(g.revenue ?? 0)

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

  // 비효율 키워드 식별 (광고비 > 0, 전환 = 0) — 전환은 14일 우선(COALESCE).
  // 14일 내 전환된 키워드는 지연 전환으로 보고 비효율에서 제외(1일 기준 오판정 완화).
  const keywordGroups = await prisma.$queryRaw<
    Array<{
      campaignId: string
      campaignName: string
      keyword: string
      adCost: number | string
      impressions: number | bigint
      clicks: number | bigint
      orders: number | bigint
    }>
  >`
    SELECT "campaignId", "campaignName", "keyword",
      SUM("adCost") AS "adCost",
      SUM("impressions") AS "impressions",
      SUM("clicks") AS "clicks",
      SUM(COALESCE("orders14d", "orders1d")) AS "orders"
    FROM "AdRecord"
    WHERE "workspaceId" = ${workspaceId}
      AND "date" >= ${startDate}
      AND "date" <= ${endDate}
      AND "keyword" IS NOT NULL
    GROUP BY "campaignId", "campaignName", "keyword"
    ORDER BY SUM("adCost") DESC
  `

  // 캠페인별 총 광고비 맵 (costRatio 계산용)
  const campaignAdCostMap = new Map<string, number>()
  for (const c of campaigns) {
    campaignAdCostMap.set(c.campaignId, c.totalAdCost)
  }

  // 표본 미달로 판정 보류된 키워드 수 (관찰용)
  let heldBelowThreshold = 0

  const inefficientKeywords: InefficientKeyword[] = keywordGroups
    .filter((g) => {
      const adCost = Number(g.adCost ?? 0)
      const orders = Number(g.orders ?? 0) // 14일 우선 전환수
      if (!(adCost > 0 && orders === 0)) return false
      // 통계 유의성 가드: 표본(클릭/노출) 또는 지출이 충분한 경우에만 비효율로 판정.
      // 클릭 1~2회 노이즈를 "전환 0 = 비효율"로 오판정하지 않도록 하한 적용.
      const clicks = Number(g.clicks ?? 0)
      const impressions = Number(g.impressions ?? 0)
      if (!hasSignificantSample(clicks, impressions, adCost)) {
        heldBelowThreshold++
        return false
      }
      return true
    })
    .map((g) => {
      const adCost = Number(g.adCost ?? 0)
      const campaignTotal = campaignAdCostMap.get(g.campaignId) ?? 0
      const costRatio =
        campaignTotal > 0
          ? Math.round((adCost / campaignTotal) * 10000) / 100 // 소수점 2자리 %
          : 0
      return {
        campaignId: g.campaignId,
        campaignName: g.campaignName,
        keyword: g.keyword,
        adCost,
        clicks: Number(g.clicks ?? 0),
        impressions: Number(g.impressions ?? 0),
        orders: 0,
        costRatio,
      }
    })

  if (heldBelowThreshold > 0) {
    console.log(
      `[data-builder] 비효율 키워드 ${inefficientKeywords.length}건 (표본 미달 판정 보류 ${heldBelowThreshold}건 제외, ` +
        `클릭<${MIN_SIGNIFICANT_CLICKS} & 노출<${MIN_SIGNIFICANT_IMPRESSIONS} & 광고비<${MIN_SIGNIFICANT_ADCOST}원)`
    )
  }

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
