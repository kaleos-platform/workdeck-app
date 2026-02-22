'use client'

import { useState, useMemo, useEffect, use } from 'react'
import { useSearchParams } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  TrendingUp,
  DollarSign,
  MousePointerClick,
  Target,
  Copy,
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Columns3,
} from 'lucide-react'
import { toast } from 'sonner'
import { FilterBar } from '@/components/dashboard/filter-bar'
import { CampaignChart } from '@/components/dashboard/campaign-chart'
import { DailyMemo } from '@/components/dashboard/daily-memo'
import type {
  AdRecord,
  InefficientKeyword,
  MetricSeries,
  DailyMemo as DailyMemoType,
} from '@/types'

// 서버사이드 정렬 가능 컬럼
type SortKey = keyof Pick<AdRecord, 'date' | 'adCost' | 'clicks' | 'impressions' | 'roas14d'>

// 키워드 탭 정렬 컬럼
type KeywordSortKey = 'keyword' | 'adCost' | 'ctr' | 'cvr' | 'roas'

// 광고 데이터 탭 표시 가능한 추가 컬럼
const TOGGLE_COLUMNS = [
  { key: 'placement', label: '광고 노출 지면' },
  { key: 'parsedProductName', label: '상품명' },
  { key: 'parsedOptionName', label: '옵션명' },
  { key: 'clicks', label: '클릭수' },
  { key: 'impressions', label: '노출수' },
] as const
type ToggleColumnKey = (typeof TOGGLE_COLUMNS)[number]['key']

function SortIcon({
  column,
  sortKey,
  sortOrder,
}: {
  column: SortKey
  sortKey: SortKey
  sortOrder: 'asc' | 'desc'
}) {
  if (sortKey !== column) return <ArrowUpDown className="ml-1 h-3.5 w-3.5 opacity-40" />
  return sortOrder === 'asc' ? (
    <ArrowUp className="ml-1 h-3.5 w-3.5 text-primary" />
  ) : (
    <ArrowDown className="ml-1 h-3.5 w-3.5 text-primary" />
  )
}

function KwSortIcon({
  column,
  sortKey,
  sortOrder,
}: {
  column: KeywordSortKey
  sortKey: KeywordSortKey
  sortOrder: 'asc' | 'desc'
}) {
  if (sortKey !== column) return <ArrowUpDown className="ml-1 h-3.5 w-3.5 opacity-40" />
  return sortOrder === 'asc' ? (
    <ArrowUp className="ml-1 h-3.5 w-3.5 text-primary" />
  ) : (
    <ArrowDown className="ml-1 h-3.5 w-3.5 text-primary" />
  )
}

function fmt(v: number | null, suffix: string): string {
  if (v === null) return '-'
  return `${v}${suffix}`
}

export default function CampaignDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>
}) {
  const { campaignId } = use(params)
  const searchParams = useSearchParams()

  // URL 필터 읽기
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''
  const adTypeFilter = searchParams.get('adType') ?? 'all'

  // 캠페인 메타 정보
  const [campaignName, setCampaignName] = useState('')
  const [adTypes, setAdTypes] = useState<string[]>([])

  // 지표 시계열
  const [metricSeries, setMetricSeries] = useState<MetricSeries[]>([])

  // 광고 데이터 탭 상태
  const [records, setRecords] = useState<AdRecord[]>([])
  const [total, setTotal] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  // 컬럼 표시 토글 (기본 숨김)
  const [visibleColumns, setVisibleColumns] = useState<Set<ToggleColumnKey>>(new Set())
  const [showColumnMenu, setShowColumnMenu] = useState(false)

  // 비효율 키워드
  const [keywords, setKeywords] = useState<InefficientKeyword[]>([])
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([])
  // 키워드 탭 정렬
  const [kwSortBy, setKwSortBy] = useState<KeywordSortKey>('adCost')
  const [kwSortOrder, setKwSortOrder] = useState<'asc' | 'desc'>('desc')

  // 메모
  const [memos, setMemos] = useState<DailyMemoType[]>([])
  // 차트 클릭으로 선택된 날짜
  const [memoTargetDate, setMemoTargetDate] = useState<string | null>(null)

  // 지표 시계열 조회
  useEffect(() => {
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    if (adTypeFilter && adTypeFilter !== 'all') q.set('adType', adTypeFilter)

    fetch(`/api/campaigns/${campaignId}/metrics?${q}`)
      .then((r) => (r.ok ? r.json() : { series: [] }))
      .then((d: { series: MetricSeries[] }) => setMetricSeries(d.series))
      .catch(() => setMetricSeries([]))
  }, [campaignId, from, to, adTypeFilter])

  // 광고 데이터 조회
  useEffect(() => {
    const q = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy: sortKey,
      sortOrder,
    })
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    if (adTypeFilter && adTypeFilter !== 'all') q.set('adType', adTypeFilter)

    fetch(`/api/campaigns/${campaignId}/records?${q}`)
      .then((r) => (r.ok ? r.json() : { items: [], total: 0 }))
      .then((d: { items: AdRecord[]; total: number }) => {
        setRecords(d.items)
        setTotal(d.total)
        if (d.items.length > 0 && !campaignName) {
          setCampaignName(d.items[0].campaignName)
        }
      })
      .catch(() => {
        setRecords([])
        setTotal(0)
      })
  }, [campaignId, page, pageSize, sortKey, sortOrder, from, to, adTypeFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // 비효율 키워드 조회
  useEffect(() => {
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    if (adTypeFilter && adTypeFilter !== 'all') q.set('adType', adTypeFilter)

    fetch(`/api/campaigns/${campaignId}/inefficient-keywords?${q}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: InefficientKeyword[] }) => {
        setKeywords(d.items)
        setSelectedKeywords([]) // 필터 변경 시 선택 초기화
      })
      .catch(() => setKeywords([]))
  }, [campaignId, from, to, adTypeFilter])

  // 메모 조회
  useEffect(() => {
    fetch(`/api/campaigns/${campaignId}/memos`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: DailyMemoType[] }) => setMemos(d.items))
      .catch(() => setMemos([]))
  }, [campaignId])

  // 캠페인 메타 (adTypes) 조회
  useEffect(() => {
    fetch('/api/campaigns')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Array<{ id: string; name: string; adTypes: string[] }>) => {
        const found = list.find((c) => c.id === campaignId)
        if (found) {
          setCampaignName(found.name)
          setAdTypes(found.adTypes)
        }
      })
      .catch(() => {})
  }, [campaignId])

  // 페이지네이션
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortOrder('desc')
    }
    setPage(1)
  }

  // 키워드 탭 정렬
  function handleKwSort(key: KeywordSortKey) {
    if (kwSortBy === key) {
      setKwSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setKwSortBy(key)
      setKwSortOrder('desc')
    }
    setSelectedKeywords([])
  }

  // 키워드 클라이언트 사이드 정렬
  const sortedKeywords = useMemo(() => {
    return [...keywords].sort((a, b) => {
      if (kwSortBy === 'keyword') {
        const cmp = a.keyword.localeCompare(b.keyword, 'ko')
        return kwSortOrder === 'asc' ? cmp : -cmp
      }
      const av = a[kwSortBy] ?? -Infinity
      const bv = b[kwSortBy] ?? -Infinity
      return kwSortOrder === 'asc'
        ? (av as number) - (bv as number)
        : (bv as number) - (av as number)
    })
  }, [keywords, kwSortBy, kwSortOrder])

  // 키워드 다중 선택
  const allKeywordNames = keywords.map((k) => k.keyword)
  const allSelected =
    selectedKeywords.length === allKeywordNames.length && allKeywordNames.length > 0

  function toggleAllKeywords() {
    setSelectedKeywords(allSelected ? [] : allKeywordNames)
  }

  function toggleKeyword(keyword: string) {
    setSelectedKeywords((prev) =>
      prev.includes(keyword) ? prev.filter((k) => k !== keyword) : [...prev, keyword]
    )
  }

  function copySelectedKeywords() {
    if (selectedKeywords.length === 0) {
      toast.error('복사할 키워드를 선택해주세요')
      return
    }
    navigator.clipboard.writeText(selectedKeywords.join(', '))
    toast.success(`${selectedKeywords.length}개 키워드가 클립보드에 복사되었습니다`)
  }

  // 컬럼 토글
  function toggleColumn(key: ToggleColumnKey) {
    setVisibleColumns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // KPI 계산 — metricSeries 합산 (CTR/CVR/ROAS null 제외 평균)
  const kpiData = useMemo(() => {
    const totalAdCost = metricSeries.reduce((s, r) => s + r.adCost, 0)
    const roasVals = metricSeries.map((r) => r.roas).filter((v): v is number => v !== null)
    const ctrVals = metricSeries.map((r) => r.ctr).filter((v): v is number => v !== null)
    const cvrVals = metricSeries.map((r) => r.cvr).filter((v): v is number => v !== null)
    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null
    return {
      totalAdCost,
      avgRoas: avg(roasVals),
      avgCtr: avg(ctrVals),
      avgCvr: avg(cvrVals),
    }
  }, [metricSeries])

  const kpiCards = [
    {
      title: '총 광고비',
      value: `${kpiData.totalAdCost.toLocaleString()}원`,
      icon: DollarSign,
      color: 'text-orange-500',
    },
    {
      title: '평균 ROAS',
      value: kpiData.avgRoas !== null ? `${kpiData.avgRoas.toFixed(1)}%` : '-',
      icon: TrendingUp,
      color: 'text-green-600',
    },
    {
      title: '평균 CTR',
      value: kpiData.avgCtr !== null ? `${kpiData.avgCtr.toFixed(1)}%` : '-',
      icon: MousePointerClick,
      color: 'text-blue-600',
    },
    {
      title: '평균 CVR',
      value: kpiData.avgCvr !== null ? `${kpiData.avgCvr.toFixed(1)}%` : '-',
      icon: Target,
      color: 'text-purple-600',
    },
  ]

  const adTypeOptions = [
    { value: 'all', label: '전체' },
    ...adTypes.map((t) => ({ value: t, label: t })),
  ]

  return (
    <div className="space-y-6">
      {/* 페이지 헤더 */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{campaignName || campaignId}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {adTypes.length > 0
            ? `${adTypes.join(' · ')} 캠페인 데이터를 분석합니다`
            : '캠페인 데이터를 분석합니다'}
        </p>
      </div>

      {/* 공통 필터 바 */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <FilterBar adTypeOptions={adTypeOptions} />
        </CardContent>
      </Card>

      {/* 탭 영역 */}
      <Tabs defaultValue="dashboard">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="dashboard">대시보드</TabsTrigger>
          <TabsTrigger value="addata">광고 데이터</TabsTrigger>
          <TabsTrigger value="keywords">키워드 분석</TabsTrigger>
        </TabsList>

        {/* ── 대시보드 탭 ── */}
        <TabsContent value="dashboard" className="space-y-6">
          {/* KPI 카드 */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {kpiCards.map((card) => {
              const Icon = card.icon
              return (
                <Card key={card.title}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                    <Icon className={`h-4 w-4 ${card.color}`} />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{card.value}</div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* 시계열 차트 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">성과 추이</CardTitle>
            </CardHeader>
            <CardContent>
              <CampaignChart
                data={metricSeries}
                memos={memos}
                onChartClick={(date) => setMemoTargetDate(date)}
              />
            </CardContent>
          </Card>

          {/* 일자별 메모 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">일자별 메모</CardTitle>
            </CardHeader>
            <CardContent>
              <DailyMemo
                campaignId={campaignId}
                initialMemos={memos}
                onMemosChange={setMemos}
                from={from || undefined}
                to={to || undefined}
                targetDate={memoTargetDate}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── 광고 데이터 탭 ── */}
        <TabsContent value="addata" className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              총 <span className="font-medium text-foreground">{total}</span>개 행
            </p>
            <div className="flex items-center gap-2">
              {/* 컬럼 토글 */}
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setShowColumnMenu((v) => !v)}
                >
                  <Columns3 className="h-3.5 w-3.5" />
                  컬럼
                </Button>
                {showColumnMenu && (
                  <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border bg-background shadow-md">
                    <div className="space-y-1 p-2">
                      {TOGGLE_COLUMNS.map((col) => (
                        <label
                          key={col.key}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                        >
                          <Checkbox
                            checked={visibleColumns.has(col.key)}
                            onCheckedChange={() => toggleColumn(col.key)}
                          />
                          {col.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v))
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-24 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10행</SelectItem>
                  <SelectItem value="25">25행</SelectItem>
                  <SelectItem value="50">50행</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => handleSort('date')}
                      >
                        <span className="flex items-center">
                          날짜
                          <SortIcon column="date" sortKey={sortKey} sortOrder={sortOrder} />
                        </span>
                      </TableHead>
                      <TableHead>광고유형</TableHead>
                      {visibleColumns.has('placement') && <TableHead>광고 노출 지면</TableHead>}
                      <TableHead>키워드</TableHead>
                      {visibleColumns.has('parsedProductName') && <TableHead>상품명</TableHead>}
                      {visibleColumns.has('parsedOptionName') && <TableHead>옵션명</TableHead>}
                      <TableHead
                        className="cursor-pointer text-right select-none"
                        onClick={() => handleSort('adCost')}
                      >
                        <span className="flex items-center justify-end">
                          광고비
                          <SortIcon column="adCost" sortKey={sortKey} sortOrder={sortOrder} />
                        </span>
                      </TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                      <TableHead className="text-right">CVR</TableHead>
                      <TableHead className="text-right">ROAS</TableHead>
                      {visibleColumns.has('clicks') && (
                        <TableHead
                          className="cursor-pointer text-right select-none"
                          onClick={() => handleSort('clicks')}
                        >
                          <span className="flex items-center justify-end">
                            클릭수
                            <SortIcon column="clicks" sortKey={sortKey} sortOrder={sortOrder} />
                          </span>
                        </TableHead>
                      )}
                      {visibleColumns.has('impressions') && (
                        <TableHead
                          className="cursor-pointer text-right select-none"
                          onClick={() => handleSort('impressions')}
                        >
                          <span className="flex items-center justify-end">
                            노출수
                            <SortIcon
                              column="impressions"
                              sortKey={sortKey}
                              sortOrder={sortOrder}
                            />
                          </span>
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={20}
                          className="py-12 text-center text-sm text-muted-foreground"
                        >
                          필터 조건에 맞는 데이터가 없습니다
                        </TableCell>
                      </TableRow>
                    ) : (
                      records.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell className="text-sm">{record.date}</TableCell>
                          <TableCell className="text-sm">{record.adType}</TableCell>
                          {visibleColumns.has('placement') && (
                            <TableCell className="text-sm text-muted-foreground">
                              {record.placement ?? '-'}
                            </TableCell>
                          )}
                          <TableCell className="text-sm text-muted-foreground">
                            {record.keyword ?? '-'}
                          </TableCell>
                          {visibleColumns.has('parsedProductName') && (
                            <TableCell
                              className="max-w-[160px] truncate text-sm"
                              title={record.parsedProductName ?? ''}
                            >
                              {record.parsedProductName ?? '-'}
                            </TableCell>
                          )}
                          {visibleColumns.has('parsedOptionName') && (
                            <TableCell className="text-sm text-muted-foreground">
                              {record.parsedOptionName ?? '-'}
                            </TableCell>
                          )}
                          <TableCell className="text-right text-sm">
                            {record.adCost.toLocaleString()}원
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {fmt(record.ctr, '%')}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {fmt(record.cvr, '%')}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {fmt(record.roas, '%')}
                          </TableCell>
                          {visibleColumns.has('clicks') && (
                            <TableCell className="text-right text-sm">
                              {record.clicks.toLocaleString()}
                            </TableCell>
                          )}
                          {visibleColumns.has('impressions') && (
                            <TableCell className="text-right text-sm">
                              {record.impressions.toLocaleString()}
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                이전
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                다음
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ── 키워드 분석 탭 ── */}
        <TabsContent value="keywords" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <span>광고비 지출 & 주문수 0인 비효율 키워드</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={copySelectedKeywords}
              disabled={selectedKeywords.length === 0}
            >
              <Copy className="h-4 w-4" />
              선택 복사 ({selectedKeywords.length})
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAllKeywords}
                        aria-label="전체 선택"
                      />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => handleKwSort('keyword')}
                    >
                      <span className="flex items-center">
                        키워드
                        <KwSortIcon column="keyword" sortKey={kwSortBy} sortOrder={kwSortOrder} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-right select-none"
                      onClick={() => handleKwSort('adCost')}
                    >
                      <span className="flex items-center justify-end">
                        광고비
                        <KwSortIcon column="adCost" sortKey={kwSortBy} sortOrder={kwSortOrder} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-right select-none"
                      onClick={() => handleKwSort('ctr')}
                    >
                      <span className="flex items-center justify-end">
                        CTR
                        <KwSortIcon column="ctr" sortKey={kwSortBy} sortOrder={kwSortOrder} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-right select-none"
                      onClick={() => handleKwSort('cvr')}
                    >
                      <span className="flex items-center justify-end">
                        CVR
                        <KwSortIcon column="cvr" sortKey={kwSortBy} sortOrder={kwSortOrder} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-right select-none"
                      onClick={() => handleKwSort('roas')}
                    >
                      <span className="flex items-center justify-end">
                        ROAS
                        <KwSortIcon column="roas" sortKey={kwSortBy} sortOrder={kwSortOrder} />
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedKeywords.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-12 text-center text-sm text-muted-foreground"
                      >
                        비효율 키워드가 없습니다
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedKeywords.map((kw) => (
                      <TableRow
                        key={kw.keyword}
                        className="cursor-pointer"
                        onClick={() => toggleKeyword(kw.keyword)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedKeywords.includes(kw.keyword)}
                            onCheckedChange={() => toggleKeyword(kw.keyword)}
                            aria-label={kw.keyword}
                          />
                        </TableCell>
                        <TableCell className="text-sm font-medium">{kw.keyword}</TableCell>
                        <TableCell className="text-right text-sm font-medium text-orange-600">
                          {kw.adCost.toLocaleString()}원
                        </TableCell>
                        <TableCell className="text-right text-sm">{fmt(kw.ctr, '%')}</TableCell>
                        <TableCell className="text-right text-sm">{fmt(kw.cvr, '%')}</TableCell>
                        <TableCell className="text-right text-sm">{fmt(kw.roas, '%')}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {selectedKeywords.length > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              {selectedKeywords.length}개 키워드 선택됨 · 복사 버튼을 클릭하면 쉼표(,) 구분으로
              클립보드에 저장됩니다
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
