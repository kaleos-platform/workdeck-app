'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { getDaysAgoStrKst } from '@/lib/date-range'
import { getCoupangAdsCampaignPath } from '@/lib/deck-routes'

type CampaignMetrics = {
  totalAdCost: number
  totalRevenue: number
  avgRoas: number | null
}

type CampaignSummary = {
  budgetUtilization: number | null
  roasAchievement: number | null
}

type CampaignWithMetrics = {
  id: string
  name: string
  displayName: string
  adTypes: string[]
  metrics: CampaignMetrics
  prevMetrics: CampaignMetrics | null
  currentTarget: { dailyBudget: number | null; targetRoas: number | null } | null
  minDate: string | null
  maxDate: string | null
  summary?: CampaignSummary
}

function calcDiff(current: number, prev: number): number | null {
  if (prev === 0) return null
  return Math.round(((current - prev) / prev) * 1000) / 10
}

function getBudgetStatus(value: number | null) {
  if (value === null) return null
  if (value >= 80 && value <= 120)
    return { label: '정상', textColor: 'text-green-600', bgColor: 'bg-green-50' }
  if (value > 120) return { label: '초과', textColor: 'text-red-600', bgColor: 'bg-red-50' }
  return { label: '부족', textColor: 'text-amber-600', bgColor: 'bg-amber-50' }
}

function getRoasStatus(value: number | null) {
  if (value === null) return null
  if (value >= 90) return { label: '좋음', textColor: 'text-green-600', bgColor: 'bg-green-50' }
  if (value >= 60) return { label: '보통', textColor: 'text-amber-600', bgColor: 'bg-amber-50' }
  return { label: '손해 위험', textColor: 'text-red-600', bgColor: 'bg-red-50' }
}

function DiffBadge({ diff, isPositive }: { diff: number | null; isPositive: boolean }) {
  if (diff === null) return null
  const color =
    diff === 0
      ? 'text-muted-foreground'
      : diff > 0 === isPositive
        ? 'text-green-600'
        : 'text-red-500'
  return (
    <div className={`flex items-center justify-end gap-0.5 text-xs ${color}`}>
      {diff > 0 ? (
        <ArrowUp className="h-3 w-3" />
      ) : diff < 0 ? (
        <ArrowDown className="h-3 w-3" />
      ) : (
        <Minus className="h-3 w-3" />
      )}
      <span>
        {diff > 0 ? `+${diff}` : diff === 0 ? '변동 없음' : `${diff}`}
        {diff !== 0 && '%'}
      </span>
    </div>
  )
}

export function CampaignListWithMetrics({ from, to }: { from: string; to: string }) {
  const [campaigns, setCampaigns] = useState<CampaignWithMetrics[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const fetchCampaigns = useCallback(async (startDate: string, endDate: string) => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/campaigns?startDate=${startDate}&endDate=${endDate}`)
      if (!res.ok) return
      const data = (await res.json()) as CampaignWithMetrics[]

      // 소진율/달성율 병렬 조회
      const summaries = await Promise.all(
        data.map((c) =>
          fetch(`/api/campaigns/${c.id}/targets/summary?from=${startDate}&to=${endDate}`)
            .then((r) =>
              r.ok
                ? (r.json() as Promise<CampaignSummary>)
                : { budgetUtilization: null, roasAchievement: null }
            )
            .catch(() => ({ budgetUtilization: null, roasAchievement: null }))
        )
      )

      setCampaigns(data.map((c, i) => ({ ...c, summary: summaries[i] })))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCampaigns(from, to)
  }, [from, to, fetchCampaigns])

  // 해당 기간에 데이터가 있는 캠페인만 표시 (광고비 또는 매출 > 0)
  const activeCampaigns = campaigns.filter(
    (c) => c.metrics.totalAdCost > 0 || c.metrics.totalRevenue > 0
  )

  // adType 기준 그룹핑
  const groups = new Map<string, CampaignWithMetrics[]>()
  for (const c of activeCampaigns) {
    const key = c.adTypes[0] ?? '기타'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }

  const yesterday = getDaysAgoStrKst(1)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">캠페인별 성과</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중...</p>
        ) : activeCampaigns.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            해당 기간에 데이터가 없습니다
          </p>
        ) : (
          <div className="space-y-1">
            {Array.from(groups.entries()).map(([adType, groupCampaigns], groupIdx) => (
              <div key={adType} className={groupIdx > 0 ? 'mt-4 border-t pt-4' : ''}>
                {/* 광고 유형 그룹 헤더 */}
                <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {adType}
                </p>

                <div className="space-y-1.5">
                  {groupCampaigns.map((campaign) => {
                    const { metrics, prevMetrics, currentTarget, summary } = campaign
                    const adCostDiff = prevMetrics
                      ? calcDiff(metrics.totalAdCost, prevMetrics.totalAdCost)
                      : null
                    const roasDiff =
                      metrics.avgRoas !== null && prevMetrics?.avgRoas != null
                        ? calcDiff(metrics.avgRoas, prevMetrics.avgRoas)
                        : null
                    const revenueDiff = prevMetrics
                      ? calcDiff(metrics.totalRevenue, prevMetrics.totalRevenue)
                      : null

                    const budgetStatus = getBudgetStatus(summary?.budgetUtilization ?? null)
                    const roasStatus = getRoasStatus(summary?.roasAchievement ?? null)

                    return (
                      <Link
                        key={campaign.id}
                        href={`${getCoupangAdsCampaignPath(campaign.id)}?from=${from}&to=${to}`}
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-6 rounded-md border px-4 py-2.5 transition-colors hover:bg-muted/50"
                      >
                        {/* Col 1: 캠페인명 + 기간/상태 */}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{campaign.displayName}</p>
                          {campaign.maxDate && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span>
                                {campaign.minDate} ~ {campaign.maxDate}
                              </span>
                              {campaign.maxDate < yesterday && (
                                <span className="font-medium text-orange-500">· 업로드 필요</span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Col 2: 일예산/소진율 + 목표ROAS/달성율 쌍 */}
                        <div className="flex gap-4 text-xs">
                          {/* 일예산 + 소진율 */}
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <span className="text-muted-foreground">일 예산</span>
                              <span className="font-medium">
                                {currentTarget?.dailyBudget != null
                                  ? `${currentTarget.dailyBudget.toLocaleString('ko-KR')}원`
                                  : '-'}
                              </span>
                            </div>
                            {budgetStatus && summary?.budgetUtilization != null ? (
                              <span className={budgetStatus.textColor}>
                                소진율 {summary.budgetUtilization.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-muted-foreground">소진율 -</span>
                            )}
                          </div>
                          {/* 목표ROAS + 달성율 */}
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <span className="text-muted-foreground">목표 ROAS</span>
                              <span className="font-medium">
                                {currentTarget?.targetRoas != null
                                  ? `${currentTarget.targetRoas}%`
                                  : '-'}
                              </span>
                            </div>
                            {roasStatus && summary?.roasAchievement != null ? (
                              <span className={roasStatus.textColor}>
                                달성율 {summary.roasAchievement.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-muted-foreground">달성율 -</span>
                            )}
                          </div>
                        </div>

                        {/* Col 3: 지표 3개 — 제목(위) · 값(중) · 증감(아래) */}
                        <div className="flex items-start gap-5">
                          <div className="min-w-[72px] text-right">
                            <p className="text-xs text-muted-foreground">총 광고비</p>
                            <p className="text-sm font-medium">
                              {metrics.totalAdCost.toLocaleString('ko-KR')}원
                            </p>
                            <DiffBadge diff={adCostDiff} isPositive={false} />
                          </div>
                          <div className="min-w-[64px] text-right">
                            <p className="text-xs text-muted-foreground">평균 ROAS</p>
                            <p className="text-sm font-medium">
                              {metrics.avgRoas !== null ? `${metrics.avgRoas.toFixed(2)}%` : '-'}
                            </p>
                            <DiffBadge diff={roasDiff} isPositive={true} />
                          </div>
                          <div className="min-w-[80px] text-right">
                            <p className="text-xs text-muted-foreground">총 매출액</p>
                            <p className="text-sm font-medium">
                              {metrics.totalRevenue.toLocaleString('ko-KR')}원
                            </p>
                            <DiffBadge diff={revenueDiff} isPositive={true} />
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
