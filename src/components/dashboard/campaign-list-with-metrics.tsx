'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { getLastNDaysRangeKst, getTodayStrKst } from '@/lib/date-range'

const QUICK_PERIODS = [
  { label: '7일', days: 7 },
  { label: '14일', days: 14 },
  { label: '30일', days: 30 },
]

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

export function CampaignListWithMetrics() {
  const today = getTodayStrKst()
  const defaultRange = getLastNDaysRangeKst(7)
  const [from, setFrom] = useState(defaultRange.from)
  const [to, setTo] = useState(defaultRange.to)
  const [activePreset, setActivePreset] = useState<number | null>(7)
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

  function handlePreset(days: number) {
    const { from: f, to: t } = getLastNDaysRangeKst(days)
    setFrom(f)
    setTo(t)
    setActivePreset(days)
  }

  function handleFromChange(value: string) {
    const clamped = value > today ? today : value
    setFrom(clamped)
    setActivePreset(null)
  }

  function handleToChange(value: string) {
    const clamped = value > today ? today : value
    setTo(clamped)
    setActivePreset(null)
  }

  // 해당 기간에 데이터가 있는 캠페인만 표시 (광고비 또는 매출 > 0)
  const activeCampaigns = campaigns.filter(
    (c) => c.metrics.totalAdCost > 0 || c.metrics.totalRevenue > 0
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">캠페인별 성과</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {/* 퀵 기간 버튼 */}
            <div className="flex items-center gap-1.5">
              {QUICK_PERIODS.map((p) => (
                <Button
                  key={p.days}
                  variant={activePreset === p.days ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => handlePreset(p.days)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            {/* 날짜 범위 직접 입력 */}
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={from}
                max={today}
                onChange={(e) => handleFromChange(e.target.value)}
                className="h-7 w-32 text-xs"
              />
              <span className="text-xs text-muted-foreground">~</span>
              <Input
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => handleToChange(e.target.value)}
                className="h-7 w-32 text-xs"
              />
            </div>
          </div>
        </div>
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
                  <div className="min-w-0">
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
                  </div>
                  <div className="flex flex-wrap items-start gap-6 text-right">
                    {/* 총 광고비 */}
                    <div>
                      <p className="text-xs text-muted-foreground">총 광고비</p>
                      <p className="text-sm font-medium text-orange-600">
                        {metrics.totalAdCost.toLocaleString('ko-KR')}원
                      </p>
                      <DiffBadge diff={adCostDiff} isPositive={false} />
                    </div>
                    {/* 평균 ROAS */}
                    <div>
                      <p className="text-xs text-muted-foreground">평균 ROAS</p>
                      <p className="text-sm font-medium">
                        {metrics.avgRoas !== null ? `${metrics.avgRoas.toFixed(2)}%` : '-'}
                      </p>
                      <DiffBadge diff={roasDiff} isPositive={true} />
                    </div>
                    {/* 총 매출액 */}
                    <div>
                      <p className="text-xs text-muted-foreground">총 매출액</p>
                      <p className="text-sm font-medium text-emerald-600">
                        {metrics.totalRevenue.toLocaleString('ko-KR')}원
                      </p>
                      <DiffBadge diff={revenueDiff} isPositive={true} />
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
