import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'

// GET /api/campaigns/[campaignId]/targets/summary
// 기간 내 일 예산 평균 소진율 & 목표 ROAS 평균 달성율 계산
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params
  const { searchParams } = request.nextUrl
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!from || !to) {
    return NextResponse.json({ budgetUtilization: null, roasAchievement: null })
  }

  const fromObj = new Date(from + 'T00:00:00+09:00')
  const toObj = new Date(to + 'T23:59:59+09:00')

  // 기간 내 모든 날짜 목록 생성 (YYYY-MM-DD)
  const dates: string[] = []
  const cursor = new Date(fromObj)
  while (cursor <= toObj) {
    dates.push(cursor.toISOString().split('T')[0])
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  // 이 기간을 커버하는 CampaignTarget 이력 조회 (effectiveDate <= to)
  type TargetRow = {
    id: string
    effectiveDate: Date
    dailyBudget: number | null
    targetRoas: number | null
  }
  const targets = (await prisma.campaignTarget.findMany({
    where: {
      workspaceId: workspace.id,
      campaignId,
      effectiveDate: { lte: toObj },
    },
    orderBy: { effectiveDate: 'asc' },
  })) as TargetRow[]

  // 기간 내 일별 광고 데이터 집계
  type DailyRow = { date: Date; _sum: { adCost: unknown; revenue1d: unknown } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dailyAggRaw: any[] = await (prisma.adRecord.groupBy as any)({
    by: ['date'],
    where: {
      workspaceId: workspace.id,
      campaignId,
      date: { gte: fromObj, lte: toObj },
    },
    _sum: { adCost: true, revenue1d: true },
  })
  const dailyAgg = dailyAggRaw as DailyRow[]

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

  return NextResponse.json({ budgetUtilization, roasAchievement })
}
