'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowDown, ArrowUp, Info, Megaphone, Minus, Percent, ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getDaysAgoStrKst, getTodayStrKst } from '@/lib/date-range'
import { COUPANG_ADS_SETTINGS_PATH } from '@/lib/deck-routes'
import type { SalesMixResult } from '@/lib/coupang-ads/sales-mix'
import type { SalesMixEmptyReason } from '@/lib/coupang-ads/sales-mix-query'
import { SalesMixTable, fmtPct, fmtWon } from './sales-mix-table'
import { SalesMixProductPanel } from './sales-mix-product-panel'

export type SalesMixResponse = SalesMixResult | { empty: SalesMixEmptyReason }

const QUICK_PERIODS = [
  { label: '7일', days: 7 },
  { label: '30일', days: 30 },
  { label: '90일', days: 90 },
]

const EMPTY_TEXT: Record<SalesMixEmptyReason, string> = {
  'collection-off': '판매 수집이 꺼져 있습니다',
  'no-data': '기간 내 판매 데이터가 없습니다',
}

const DAY_MS = 86400000
const addDays = (ymd: string, n: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
const md = (ymd: string) => ymd.slice(5).replace('-', '/')

type Tone = 'upGood' | 'downGood' | 'neutral'

// 증감 표시. tone 으로 좋은 방향을 지정한다 (광고비 비중은 감소가 좋음).
function Delta({ diff, unit, tone }: { diff: number | null; unit: '%' | '%p'; tone: Tone }) {
  if (diff === null) {
    return (
      <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        이전 기간 없음
      </span>
    )
  }
  const r = Math.round(diff * 10) / 10
  const good = tone === 'upGood' ? r > 0 : r < 0
  const color =
    r === 0 || tone === 'neutral'
      ? 'text-muted-foreground'
      : good
        ? 'text-emerald-600'
        : 'text-red-500'
  return (
    <span className={cn('flex items-center gap-0.5 text-xs', color)}>
      {r > 0 ? (
        <ArrowUp className="h-3 w-3" />
      ) : r < 0 ? (
        <ArrowDown className="h-3 w-3" />
      ) : (
        <Minus className="h-3 w-3" />
      )}
      {r > 0 ? `+${r}` : r}
      {unit} 이전 대비
    </span>
  )
}

const pctChange = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null)
const ppChange = (cur: number | null, prev: number | null) =>
  cur === null || prev === null ? null : (cur - prev) * 100

export function SalesMixClient({
  initialFrom,
  initialTo,
  initialData,
}: {
  initialFrom: string
  initialTo: string
  initialData?: SalesMixResponse
}) {
  const today = getTodayStrKst()
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [activePreset, setActivePreset] = useState<number | null>(30)
  const [result, setResult] = useState<{
    from: string
    to: string
    data: SalesMixResponse | null
  } | null>(initialData ? { from: initialFrom, to: initialTo, data: initialData } : null)
  const [selected, setSelected] = useState<{ productId: string; productName: string } | null>(null)
  const data = result?.from === from && result.to === to ? result.data : undefined

  // 서버 초기 데이터가 있으면 첫 조회는 건너뛴다. 실패 시 클라에서 다시 조회.
  const skipFirst = useRef(!!initialData)
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false
      return
    }
    if (from > to) return
    const controller = new AbortController()
    const settle = (d: SalesMixResponse | null) => {
      if (!controller.signal.aborted) setResult({ from, to, data: d })
    }
    fetch(`/api/coupang-ads/sales-mix?startDate=${from}&endDate=${to}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<SalesMixResponse>) : null))
      .then(settle)
      .catch(() => settle(null))
    return () => controller.abort()
  }, [from, to])

  function handlePreset(days: number) {
    setFrom(getDaysAgoStrKst(days))
    setTo(getDaysAgoStrKst(1))
    setActivePreset(days)
  }
  const clamp = (v: string) => (v > today ? today : v)

  return (
    <div className="space-y-6">
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
            onChange={(e) => {
              setFrom(clamp(e.target.value))
              setActivePreset(null)
            }}
            className="h-7 w-32 text-xs"
          />
          <span className="text-xs text-muted-foreground">~</span>
          <Input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => {
              setTo(clamp(e.target.value))
              setActivePreset(null)
            }}
            className="h-7 w-32 text-xs"
          />
        </div>
      </div>

      {data === undefined ? (
        <p className="py-12 text-center text-sm text-muted-foreground">불러오는 중…</p>
      ) : data === null ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          매출 구성을 불러오지 못했습니다
        </p>
      ) : 'empty' in data ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">{EMPTY_TEXT[data.empty]}</p>
            <Button asChild size="sm" variant="outline">
              <Link href={COUPANG_ADS_SETTINGS_PATH}>설정에서 판매 수집 켜기</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <SalesMixBody
          data={data}
          onSelect={(id) => {
            const row = data.products.find((p) => p.productId === id)
            setSelected({ productId: id, productName: row?.productName ?? '' })
          }}
          selectedId={selected?.productId ?? null}
        />
      )}

      <SalesMixProductPanel
        product={selected}
        from={from}
        to={to}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}

function SalesMixBody({
  data,
  onSelect,
  selectedId,
}: {
  data: SalesMixResult
  onSelect: (productId: string) => void
  selectedId: string | null
}) {
  const { kpi, prevKpi } = data
  const cards = [
    {
      title: '전체 매출',
      icon: ShoppingCart,
      value: fmtWon(kpi.revenue),
      delta: <Delta diff={pctChange(kpi.revenue, prevKpi.revenue)} unit="%" tone="upGood" />,
      prev: prevKpi.revenue > 0 ? fmtWon(prevKpi.revenue) : null,
    },
    {
      title: '광고비',
      icon: Megaphone,
      value: fmtWon(kpi.adCost),
      delta: <Delta diff={pctChange(kpi.adCost, prevKpi.adCost)} unit="%" tone="neutral" />,
      prev: prevKpi.adCost > 0 ? fmtWon(prevKpi.adCost) : null,
    },
    {
      title: '광고비 비중',
      icon: Percent,
      value: fmtPct(kpi.adShare),
      delta: <Delta diff={ppChange(kpi.adShare, prevKpi.adShare)} unit="%p" tone="downGood" />,
      prev: prevKpi.adShare !== null ? fmtPct(prevKpi.adShare) : null,
    },
    {
      title: '쿠팡 기준 광고매출 비중',
      icon: Info,
      tip: '쿠팡 광고 리포트의 광고매출 ÷ 전체 매출. 클릭 후 1일 내 구매를 모두 포함해 100%를 넘을 수 있습니다.',
      value: fmtPct(kpi.coupangAdRevenueShare),
      delta: (
        <Delta
          diff={ppChange(kpi.coupangAdRevenueShare, prevKpi.coupangAdRevenueShare)}
          unit="%p"
          tone="neutral"
        />
      ),
      prev: prevKpi.coupangAdRevenueShare !== null ? fmtPct(prevKpi.coupangAdRevenueShare) : null,
    },
  ]

  const weeks = data.weeks.map((w) => {
    const start = w.weekStart < data.from ? data.from : w.weekStart
    const endRaw = addDays(w.weekStart, 6)
    const end = endRaw > data.to ? data.to : endRaw
    return {
      ...w,
      label: md(w.weekStart),
      range: `${md(start)} ~ ${md(end)}`,
      adSharePct: w.adShare === null ? null : w.adShare * 100,
    }
  })

  return (
    <>
      {data.missingDays > 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          기간 중 {data.missingDays}일 판매 데이터 없음
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <Card key={c.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{c.title}</CardTitle>
                {c.tip ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label={`${c.title} 설명`}>
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{c.tip}</TooltipContent>
                  </Tooltip>
                ) : (
                  <Icon className="h-4 w-4 text-muted-foreground" />
                )}
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">{c.value}</div>
                <div className="mt-1 flex items-center gap-1">{c.delta}</div>
                {c.prev !== null && (
                  <p className="mt-0.5 text-xs text-muted-foreground">이전: {c.prev}</p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">주별 전체 매출 · 광고비 비중</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={weeks}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11 }}
                  width={56}
                  tickFormatter={(v: number) =>
                    Math.abs(v) >= 10000
                      ? `${Math.round(v / 10000).toLocaleString('ko-KR')}만원`
                      : `${v}원`
                  }
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  width={40}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <ChartTooltip
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.range ?? ''}
                  formatter={(v, name) =>
                    name === '광고비 비중' ? `${Number(v).toFixed(1)}%` : fmtWon(Number(v))
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="revenue" name="전체 매출" fill="#a1a1aa" />
                <Line
                  yAxisId="right"
                  dataKey="adSharePct"
                  name="광고비 비중"
                  stroke="#f97316"
                  strokeWidth={2}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <SalesMixTable rows={data.products} onSelect={onSelect} selectedId={selectedId} />
    </>
  )
}
