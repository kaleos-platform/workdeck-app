'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { getDaysAgoStrKst } from '@/lib/date-range'

type CampaignMetrics = {
  totalAdCost: number
  totalRevenue: number
  avgRoas: number | null
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
}

function calcDiff(current: number, prev: number): number | null {
  if (prev === 0) return null
  return Math.round(((current - prev) / prev) * 1000) / 10
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
    <span className={`flex items-center gap-0.5 text-xs ${color}`}>
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
    </span>
  )
}

export function CampaignListWithMetrics({ from, to }: { from: string; to: string }) {
  const [campaigns, setCampaigns] = useState<CampaignWithMetrics[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const fetchCampaigns = useCallback(async (startDate: string, endDate: string) => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/campaigns?startDate=${startDate}&endDate=${endDate}`)
      if (res.ok) {
        setCampaigns((await res.json()) as CampaignWithMetrics[])
      }
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
          <div className="space-y-2">
            {activeCampaigns.map((campaign) => {
              const { metrics, prevMetrics } = campaign
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

              const { currentTarget } = campaign
              return (
                <Link
                  key={campaign.id}
                  href={`/dashboard/campaigns/${campaign.id}?from=${from}&to=${to}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{campaign.displayName}</p>
                    <p className="text-xs text-muted-foreground">{campaign.adTypes.join(' · ')}</p>
                    {/* 일 예산 / 목표 ROAS */}
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        일 예산:{' '}
                        <span className="font-medium text-foreground">
                          {currentTarget?.dailyBudget != null
                            ? `${currentTarget.dailyBudget.toLocaleString('ko-KR')}원`
                            : '-'}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">
                        목표 ROAS:{' '}
                        <span className="font-medium text-foreground">
                          {currentTarget?.targetRoas != null ? `${currentTarget.targetRoas}%` : '-'}
                        </span>
                      </span>
                    </div>
                    {/* 데이터 기간 표시 */}
                    {campaign.maxDate && (
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">
                          데이터: {campaign.minDate} ~ {campaign.maxDate}
                        </span>
                        {campaign.maxDate < getDaysAgoStrKst(1) && (
                          <span className="font-medium text-orange-500">· 업로드 필요</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-4 text-right">
                    {/* 총 광고비 */}
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">총 광고비</p>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium text-orange-600">
                          {metrics.totalAdCost.toLocaleString('ko-KR')}원
                        </span>
                        <DiffBadge diff={adCostDiff} isPositive={false} />
                      </div>
                    </div>
                    {/* 평균 ROAS */}
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">평균 ROAS</p>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium">
                          {metrics.avgRoas !== null ? `${metrics.avgRoas.toFixed(2)}%` : '-'}
                        </span>
                        <DiffBadge diff={roasDiff} isPositive={true} />
                      </div>
                    </div>
                    {/* 총 매출액 */}
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">총 매출액</p>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium text-emerald-600">
                          {metrics.totalRevenue.toLocaleString('ko-KR')}원
                        </span>
                        <DiffBadge diff={revenueDiff} isPositive={true} />
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
