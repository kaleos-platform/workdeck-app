'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DollarSign,
  TrendingUp,
  ShoppingCart,
  MousePointerClick,
  Target,
  ArrowUp,
  ArrowDown,
  Minus,
  UploadCloud,
} from 'lucide-react'
import { getLastNDaysRangeKst, getDaysAgoStrKst, getTodayStrKst } from '@/lib/date-range'
import { CampaignListWithMetrics } from '@/components/dashboard/campaign-list-with-metrics'

const QUICK_PERIODS = [
  { label: '7일', days: 7 },
  { label: '14일', days: 14 },
  { label: '30일', days: 30 },
]

type KpiData = {
  adCost: number
  roas: number | null
  revenue: number
  ctr: number | null
  cvr: number | null
  prevAdCost: number
  prevRoas: number | null
  prevRevenue: number
  prevCtr: number | null
  prevCvr: number | null
  wow: {
    adCost: number | null
    roas: number | null
    revenue: number | null
    ctr: number | null
    cvr: number | null
  }
}

function WowBadge({ diff, higherIsBetter }: { diff: number | null; higherIsBetter: boolean }) {
  if (diff === null) {
    return (
      <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        이전 기간 없음
      </span>
    )
  }
  if (diff === 0) {
    return (
      <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        변동 없음
      </span>
    )
  }
  const isGood = diff > 0 === higherIsBetter
  return (
    <span
      className={`flex items-center gap-0.5 text-xs ${isGood ? 'text-green-600' : 'text-red-500'}`}
    >
      {diff > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {diff > 0 ? `+${diff}` : diff}% 이전 대비
    </span>
  )
}

export function DashboardClient({ hasData }: { hasData: boolean }) {
  const today = getTodayStrKst()
  const [from, setFrom] = useState(getDaysAgoStrKst(7))
  const [to, setTo] = useState(getDaysAgoStrKst(1))
  const [activePreset, setActivePreset] = useState<number | null>(7)
  const [kpi, setKpi] = useState<KpiData | null>(null)
  const [kpiLoading, setKpiLoading] = useState(false)

  const fetchKpi = useCallback(async (startDate: string, endDate: string) => {
    setKpiLoading(true)
    try {
      const res = await fetch(`/api/dashboard/kpi?startDate=${startDate}&endDate=${endDate}`)
      if (res.ok) {
        setKpi((await res.json()) as KpiData)
      }
    } finally {
      setKpiLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKpi(from, to)
  }, [from, to, fetchKpi])

  function handlePreset(days: number) {
    setFrom(getDaysAgoStrKst(days))
    setTo(getDaysAgoStrKst(1))
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

  const kpiCards = [
    {
      title: '총 광고비',
      value: kpi ? `${kpi.adCost.toLocaleString('ko-KR')}원` : '-',
      icon: DollarSign,
      color: 'text-orange-500',
      wow: kpi?.wow.adCost ?? null,
      prevValue: kpi && kpi.prevAdCost > 0 ? `${kpi.prevAdCost.toLocaleString('ko-KR')}원` : null,
      higherIsBetter: false,
    },
    {
      title: '평균 ROAS',
      value: kpi?.roas != null ? `${kpi.roas.toFixed(1)}%` : '-',
      icon: TrendingUp,
      color: 'text-green-600',
      wow: kpi?.wow.roas ?? null,
      prevValue: kpi?.prevRoas != null ? `${kpi.prevRoas.toFixed(1)}%` : null,
      higherIsBetter: true,
    },
    {
      title: '총 매출액',
      value: kpi ? `${kpi.revenue.toLocaleString('ko-KR')}원` : '-',
      icon: ShoppingCart,
      color: 'text-emerald-600',
      wow: kpi?.wow.revenue ?? null,
      prevValue: kpi && kpi.prevRevenue > 0 ? `${kpi.prevRevenue.toLocaleString('ko-KR')}원` : null,
      higherIsBetter: true,
    },
    {
      title: '평균 CTR',
      value: kpi?.ctr != null ? `${kpi.ctr.toFixed(2)}%` : '-',
      icon: MousePointerClick,
      color: 'text-blue-600',
      wow: kpi?.wow.ctr ?? null,
      prevValue: kpi?.prevCtr != null ? `${kpi.prevCtr.toFixed(2)}%` : null,
      higherIsBetter: true,
    },
    {
      title: '평균 CVR',
      value: kpi?.cvr != null ? `${kpi.cvr.toFixed(2)}%` : '-',
      icon: Target,
      color: 'text-purple-600',
      wow: kpi?.wow.cvr ?? null,
      prevValue: kpi?.prevCvr != null ? `${kpi.prevCvr.toFixed(2)}%` : null,
      higherIsBetter: true,
    },
  ]

  return (
    <div className="space-y-6">
      {/* 데이터 없을 때 CTA 배너 */}
      {!hasData && (
        <Card className="border-2 border-dashed border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="rounded-full bg-orange-100 p-4 dark:bg-orange-900/30">
              <UploadCloud className="h-8 w-8 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold">아직 리포트가 없습니다</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                쿠팡 셀러센터에서 광고 리포트 Excel 파일을 다운로드하여 업로드하세요. 업로드하면
                캠페인별 성과를 바로 분석할 수 있습니다.
              </p>
            </div>
            <Link href="/dashboard/upload">
              <Button className="gap-2">
                <UploadCloud className="h-4 w-4" />첫 리포트 업로드하기
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* 날짜 선택 UI (최상단) */}
      <div className="flex flex-wrap items-center gap-2">
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

      {/* KPI 카드 5개 */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {kpiCards.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                <Icon className={`h-4 w-4 ${card.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{kpiLoading ? '-' : card.value}</div>
                <div className="mt-1 flex items-center gap-1">
                  {kpiLoading ? (
                    <span className="text-xs text-muted-foreground">-</span>
                  ) : (
                    <WowBadge diff={card.wow} higherIsBetter={card.higherIsBetter} />
                  )}
                </div>
                {!kpiLoading && card.prevValue !== null && (
                  <p className="mt-0.5 text-xs text-muted-foreground">이전: {card.prevValue}</p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 캠페인별 성과 */}
      {hasData && <CampaignListWithMetrics from={from} to={to} />}
    </div>
  )
}
