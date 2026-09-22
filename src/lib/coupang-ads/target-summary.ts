import 'server-only'

import { prisma } from '@/lib/prisma'
import { cacheCoupangAdsData } from './cache'
import { measureCoupangAds } from './server-timing'

export type CampaignTargetSummary = {
  budgetUtilization: number | null
  roasAchievement: number | null
}
type TargetRow = {
  campaignId: string
  effectiveDate: Date
  dailyBudget: number | null
  targetRoas: number | null
}
type DailyRow = { campaignId: string; date: Date; _sum: { adCost: unknown; revenue1d: unknown } }

function calculateSummary(
  dates: string[],
  targets: TargetRow[],
  dailyAgg: DailyRow[]
): CampaignTargetSummary {
  // 날짜별 adCost/revenue 맵 (YYYY-MM-DD → 값)
  const dailyMap = new Map<string, { adCost: number; revenue1d: number }>()
  for (const row of dailyAgg) {
    const key = row.date.toISOString().split('T')[0]
    dailyMap.set(key, {
      adCost: Number(row._sum.adCost ?? 0),
      revenue1d: Number(row._sum.revenue1d ?? 0),
    })
  }

  // 날짜 D에 유효한 CampaignTarget 조회 (effectiveDate <= D인 가장 최근 항목)
  function getEffectiveTarget(dateStr: string): TargetRow | null {
    // targets는 effectiveDate asc 정렬 → 역순으로 탐색
    for (let i = targets.length - 1; i >= 0; i--) {
      const t = targets[i]
      const tStr = t.effectiveDate.toISOString().split('T')[0]
      if (tStr <= dateStr) return t
    }
    return null
  }

  // 기간 전체 집계 변수
  let totalAdCost = 0
  let totalApplicableBudget = 0
  let hasBudget = false

  let totalRevenue = 0
  let sumTargetRoas = 0
  let countTargetRoas = 0

  for (const dateStr of dates) {
    const target = getEffectiveTarget(dateStr)
    const daily = dailyMap.get(dateStr)
    const adCost = daily?.adCost ?? 0
    const revenue1d = daily?.revenue1d ?? 0

    totalAdCost += adCost
    totalRevenue += revenue1d

    // 일 예산 합산 (carry-forward 포함)
    if (
      target?.dailyBudget !== null &&
      target?.dailyBudget !== undefined &&
      target.dailyBudget > 0
    ) {
      totalApplicableBudget += target.dailyBudget
      hasBudget = true
    }

    // 목표 ROAS 합산 (평균 계산용)
    if (target?.targetRoas !== null && target?.targetRoas !== undefined && target.targetRoas > 0) {
      sumTargetRoas += target.targetRoas
      countTargetRoas++
    }
  }

  // 소진율: 전체 광고비 / 전체 적용 일 예산 * 100
  const budgetUtilization =
    hasBudget && totalApplicableBudget > 0
      ? Math.round((totalAdCost / totalApplicableBudget) * 100 * 100) / 100
      : null

  // 달성율: 실제 기간 ROAS / 기간 평균 목표 ROAS * 100
  const avgTargetRoas = countTargetRoas > 0 ? sumTargetRoas / countTargetRoas : 0
  const actualRoas = totalAdCost > 0 ? (totalRevenue / totalAdCost) * 100 : 0
  const roasAchievement =
    avgTargetRoas > 0 ? Math.round((actualRoas / avgTargetRoas) * 100 * 100) / 100 : null

  return { budgetUtilization, roasAchievement }
}

async function loadSummaries(
  workspaceId: string,
  from: string,
  to: string,
  campaignId?: string
): Promise<Record<string, CampaignTargetSummary>> {
  const fromObj = new Date(from + 'T00:00:00+09:00')
  const toObj = new Date(to + 'T23:59:59+09:00')
  // 기존 단건 API의 KST→UTC 날짜 순회를 그대로 보존한다.
  const dates: string[] = []
  const cursor = new Date(fromObj)
  while (cursor <= toObj) {
    dates.push(cursor.toISOString().split('T')[0])
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  const scope = { workspaceId, ...(campaignId === undefined ? {} : { campaignId }) }
  const [targets, dailyRows] = await Promise.all([
    prisma.campaignTarget.findMany({
      where: { ...scope, effectiveDate: { lte: toObj } },
      orderBy: { effectiveDate: 'asc' },
      select: { campaignId: true, effectiveDate: true, dailyBudget: true, targetRoas: true },
    }),
    prisma.adRecord.groupBy({
      by: ['campaignId', 'date'],
      where: { ...scope, date: { gte: fromObj, lte: toObj } },
      _sum: { adCost: true, revenue1d: true },
    }),
  ])
  const grouped = new Map<string, { targets: TargetRow[]; daily: DailyRow[] }>()
  const getGroup = (id: string) => {
    let group = grouped.get(id)
    if (!group) {
      group = { targets: [], daily: [] }
      grouped.set(id, group)
    }
    return group
  }
  for (const row of targets) getGroup(row.campaignId).targets.push(row)
  for (const row of dailyRows) getGroup(row.campaignId).daily.push(row)
  return Object.fromEntries(
    [...grouped].map(([id, group]) => [id, calculateSummary(dates, group.targets, group.daily)])
  )
}

export async function queryCampaignTargetSummaries(
  workspaceId: string,
  from: string,
  to: string
): Promise<Record<string, CampaignTargetSummary>> {
  return cacheCoupangAdsData('target-summaries', { workspaceId, from, to }, () =>
    measureCoupangAds('summary_loader', () => loadSummaries(workspaceId, from, to))
  )
}

export async function queryCampaignTargetSummary(
  workspaceId: string,
  campaignId: string,
  from: string,
  to: string
): Promise<CampaignTargetSummary> {
  const summaries = await cacheCoupangAdsData(
    'target-summaries',
    { workspaceId, campaignId, from, to },
    () =>
      measureCoupangAds('summary_loader', () => loadSummaries(workspaceId, from, to, campaignId))
  )
  return summaries[campaignId] ?? { budgetUtilization: null, roasAchievement: null }
}
