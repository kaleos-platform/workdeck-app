import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  calculateCTR,
  calculateCVR,
  calculateEngagementRate,
  calculateROAS,
} from '@/lib/metrics-calculator'
import { formatDateToYmdKst } from '@/lib/date-range'
import type { DailyMemo, MetricSeries } from '@/types'
import { cacheCoupangAdsData } from '@/lib/coupang-ads/cache'

export type CampaignOverviewInput = {
  workspaceId: string
  campaignId: string
  from: string
  to: string
  adType: string
}

export type CampaignTargetData = {
  id: string
  campaignId: string
  effectiveDate: string
  dailyBudget: number | null
  targetRoas: number | null
}

export type CampaignOverview = {
  campaign: {
    id: string
    name: string
    displayName: string
    isCustomName: boolean
    adTypes: string[]
  }
  metricSeries: MetricSeries[]
  prevMetricSeries: MetricSeries[]
  targets: CampaignTargetData[]
  targetSummary: {
    budgetUtilization: number | null
    roasAchievement: number | null
  }
  memos: DailyMemo[]
}

type MetricGroup = {
  date: Date
  _sum: {
    adCost: unknown
    clicks: unknown
    impressions: unknown
    orders1d: unknown
    revenue1d: unknown
    engagements: unknown
  }
}

function normalizeMetricSeries(groups: MetricGroup[]): MetricSeries[] {
  return groups.map((item) => {
    const adCost = Number(item._sum.adCost ?? 0)
    const clicks = Number(item._sum.clicks ?? 0)
    const impressions = Number(item._sum.impressions ?? 0)
    const orders1d = Number(item._sum.orders1d ?? 0)
    const revenue1d = Number(item._sum.revenue1d ?? 0)
    const engagements = Number(item._sum.engagements ?? 0)

    return {
      date: formatDateToYmdKst(item.date),
      adCost,
      totalRevenue: revenue1d,
      impressions,
      engagements,
      ctr: calculateCTR(clicks, impressions),
      cvr: calculateCVR(orders1d, clicks),
      roas: calculateROAS(revenue1d, adCost),
      engagementRate: calculateEngagementRate(engagements, impressions),
    }
  })
}

function getPreviousRange(from: string, to: string): { from: Date; to: Date } {
  const fromMs = new Date(`${from}T00:00:00+09:00`).getTime()
  const toMs = new Date(`${to}T00:00:00+09:00`).getTime()
  const days = Math.round((toMs - fromMs) / 86400000) + 1
  return {
    from: new Date(fromMs - days * 86400000),
    to: new Date(fromMs - 1),
  }
}

function toTargetDate(date: Date): string {
  return new Date(date.getTime() + 86400000).toISOString().split('T')[0]
}

function calculateTargetSummary(
  from: string,
  to: string,
  targets: CampaignTargetData[],
  series: MetricSeries[]
): CampaignOverview['targetSummary'] {
  const dailyMap = new Map(series.map((item) => [item.date, item]))
  let totalAdCost = 0
  let totalRevenue = 0
  let totalBudget = 0
  let targetRoasSum = 0
  let targetRoasCount = 0

  for (
    let cursor = new Date(`${from}T00:00:00+09:00`);
    cursor <= new Date(`${to}T00:00:00+09:00`);
    cursor = new Date(cursor.getTime() + 86400000)
  ) {
    const date = formatDateToYmdKst(cursor)
    const metric = dailyMap.get(date)
    totalAdCost += metric?.adCost ?? 0
    totalRevenue += metric?.totalRevenue ?? 0

    const target = targets.find((item) => item.effectiveDate <= date)
    if (target?.dailyBudget != null && target.dailyBudget > 0) totalBudget += target.dailyBudget
    if (target?.targetRoas != null && target.targetRoas > 0) {
      targetRoasSum += target.targetRoas
      targetRoasCount += 1
    }
  }

  const budgetUtilization =
    totalBudget > 0 ? Math.round((totalAdCost / totalBudget) * 10000) / 100 : null
  const actualRoas = totalAdCost > 0 ? (totalRevenue / totalAdCost) * 100 : 0
  const avgTargetRoas = targetRoasCount > 0 ? targetRoasSum / targetRoasCount : 0
  const roasAchievement =
    avgTargetRoas > 0 ? Math.round((actualRoas / avgTargetRoas) * 10000) / 100 : null

  return { budgetUtilization, roasAchievement }
}

export async function loadCampaignOverview(
  input: CampaignOverviewInput
): Promise<CampaignOverview> {
  const currentFrom = new Date(`${input.from}T00:00:00+09:00`)
  const currentTo = new Date(`${input.to}T23:59:59+09:00`)
  const previous = getPreviousRange(input.from, input.to)
  const adTypeFilter = input.adType && input.adType !== 'all' ? { adType: input.adType } : undefined

  const [latestRecord, adTypeRows, meta, currentGroups, previousGroups, targetRows, memoRows] =
    await Promise.all([
      prisma.adRecord.findFirst({
        where: { workspaceId: input.workspaceId, campaignId: input.campaignId },
        orderBy: { date: 'desc' },
        select: { campaignName: true },
      }),
      prisma.adRecord.groupBy({
        by: ['adType'],
        where: { workspaceId: input.workspaceId, campaignId: input.campaignId },
      }),
      prisma.campaignMeta.findUnique({
        where: {
          workspaceId_campaignId: {
            workspaceId: input.workspaceId,
            campaignId: input.campaignId,
          },
        },
        select: { displayName: true, isCustomName: true },
      }),
      prisma.adRecord.groupBy({
        by: ['date'],
        where: {
          workspaceId: input.workspaceId,
          campaignId: input.campaignId,
          date: { gte: currentFrom, lte: currentTo },
          ...adTypeFilter,
        },
        _sum: {
          adCost: true,
          clicks: true,
          impressions: true,
          orders1d: true,
          revenue1d: true,
          engagements: true,
        },
        orderBy: { date: 'asc' },
      }),
      prisma.adRecord.groupBy({
        by: ['date'],
        where: {
          workspaceId: input.workspaceId,
          campaignId: input.campaignId,
          date: { gte: previous.from, lte: previous.to },
          ...adTypeFilter,
        },
        _sum: {
          adCost: true,
          clicks: true,
          impressions: true,
          orders1d: true,
          revenue1d: true,
          engagements: true,
        },
        orderBy: { date: 'asc' },
      }),
      prisma.campaignTarget.findMany({
        where: { workspaceId: input.workspaceId, campaignId: input.campaignId },
        orderBy: { effectiveDate: 'desc' },
        select: {
          id: true,
          campaignId: true,
          effectiveDate: true,
          dailyBudget: true,
          targetRoas: true,
        },
      }),
      prisma.dailyMemo.findMany({
        where: { workspaceId: input.workspaceId, campaignId: input.campaignId },
        orderBy: { date: 'desc' },
        select: {
          id: true,
          campaignId: true,
          date: true,
          content: true,
          updatedAt: true,
        },
      }),
    ])

  if (!latestRecord) throw new Error('CAMPAIGN_NOT_FOUND')

  const metricSeries = normalizeMetricSeries(currentGroups as MetricGroup[])
  const prevMetricSeries = normalizeMetricSeries(previousGroups as MetricGroup[])
  const targets = targetRows.map((target) => ({
    ...target,
    effectiveDate: toTargetDate(target.effectiveDate),
  }))
  const memos = memoRows.map((memo) => ({
    ...memo,
    date: formatDateToYmdKst(memo.date),
    updatedAt: formatDateToYmdKst(memo.updatedAt),
  }))

  return {
    campaign: {
      id: input.campaignId,
      name: latestRecord.campaignName,
      displayName: meta?.displayName ?? latestRecord.campaignName,
      isCustomName: meta?.isCustomName ?? false,
      adTypes: adTypeRows.map((row) => row.adType),
    },
    metricSeries,
    prevMetricSeries,
    targets,
    targetSummary: calculateTargetSummary(input.from, input.to, targets, metricSeries),
    memos,
  }
}

export function getCachedCampaignOverview(input: CampaignOverviewInput): Promise<CampaignOverview> {
  return cacheCoupangAdsData('overview', input, () => loadCampaignOverview(input))
}
