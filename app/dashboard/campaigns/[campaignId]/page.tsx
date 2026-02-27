'use client'

import { useState, useMemo, useEffect, useLayoutEffect, useRef, use } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  ShoppingCart,
  MousePointerClick,
  Target,
  Copy,
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Columns3,
  Pencil,
  Check,
  X,
  Trash2,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { FilterBar } from '@/components/dashboard/filter-bar'
import { CampaignChart } from '@/components/dashboard/campaign-chart'
import { DailyMemo } from '@/components/dashboard/daily-memo'
import { getLastNDaysRangeKst, isYmdDateString } from '@/lib/date-range'
import type {
  AdRecord,
  InefficientKeyword,
  MetricSeries,
  DailyMemo as DailyMemoType,
} from '@/types'

// 광고 데이터 탭 정렬 컬럼 (현재 페이지 표시 행 기준 클라이언트 정렬)
type SortKey =
  | 'date'
  | 'roas'
  | 'cvr'
  | 'ctr'
  | 'adCost'
  | 'impressions'
  | 'clicks'
  | 'orders1d'
  | 'revenue1d'
  | 'engagements'

// 키워드 탭 정렬 컬럼
type KeywordSortKey = 'keyword' | 'adCost' | 'ctr' | 'cvr' | 'roas'
type TabValue = 'dashboard' | 'keywords' | 'addata'
const DEFAULT_RANGE_DAYS = 14

// 광고 데이터 탭 토글 가능한 추가 컬럼
const TOGGLE_COLUMNS = [
  { key: 'placement', label: '광고 노출 지면' },
  { key: 'parsedProductName', label: '상품명' },
  { key: 'parsedOptionName', label: '옵션명' },
  { key: 'impressions', label: '노출수' },
  { key: 'engagements', label: '참여수' },
  { key: 'clicks', label: '클릭수' },
  { key: 'orders1d', label: '주문 건수' },
  { key: 'revenue1d', label: '매출 금액' },
] as const
type ToggleColumnKey = (typeof TOGGLE_COLUMNS)[number]['key']

// 텍스트가 잘릴 때만 shadcn Tooltip을 표시하는 테이블 셀
function TruncatedCell({
  text,
  className,
}: {
  text: string | null | undefined
  className?: string
}) {
  const ref = useRef<HTMLTableCellElement>(null)
  const [showTooltip, setShowTooltip] = useState(false)
  const display = text ?? '-'

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !text) return
    const truncated = el.scrollWidth > el.offsetWidth
    if (truncated !== showTooltip) setShowTooltip(truncated)
  })

  const cell = (
    <TableCell ref={ref} className={className}>
      {display}
    </TableCell>
  )

  if (!showTooltip) return cell

  return (
    <Tooltip>
      <TooltipTrigger asChild>{cell}</TooltipTrigger>
      <TooltipContent>
        <p className="max-w-xs break-words">{text}</p>
      </TooltipContent>
    </Tooltip>
  )
}

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
  if (suffix === '%') return `${v.toFixed(2)}%`
  return `${v.toLocaleString('ko-KR')}${suffix}`
}

export default function CampaignDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { campaignId } = use(params)
  const searchParams = useSearchParams()
  const searchParamsString = searchParams.toString()

  // URL 필터 읽기
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''
  const adTypeFilter = searchParams.get('adType') ?? 'all'
  const tab = searchParams.get('tab')
  const isDateRangeReady = isYmdDateString(from) && isYmdDateString(to)
  const activeTab: TabValue =
    tab === 'keywords' || tab === 'addata' || tab === 'dashboard' ? tab : 'dashboard'

  // 캠페인 메타 정보
  const [campaignName, setCampaignName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [adTypes, setAdTypes] = useState<string[]>([])

  // 캠페인명 인라인 편집
  const [isEditingName, setIsEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState('')

  // 지표 시계열
  const [metricSeries, setMetricSeries] = useState<MetricSeries[]>([])

  // 광고 데이터 탭 상태
  const [records, setRecords] = useState<AdRecord[]>([])
  const [total, setTotal] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  // 컬럼 표시 토글 (기본 전체 선택)
  const [visibleColumns, setVisibleColumns] = useState<Set<ToggleColumnKey>>(
    new Set(TOGGLE_COLUMNS.map((c) => c.key))
  )
  const [showColumnMenu, setShowColumnMenu] = useState(false)
  const [placementFilter, setPlacementFilter] = useState('all')
  const [placementOptions, setPlacementOptions] = useState<string[]>([])
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeletingCampaign, setIsDeletingCampaign] = useState(false)

  // 비효율 키워드
  const [keywords, setKeywords] = useState<InefficientKeyword[]>([])
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([])
  // 키워드 탭 정렬
  const [kwSortBy, setKwSortBy] = useState<KeywordSortKey>('adCost')
  const [kwSortOrder, setKwSortOrder] = useState<'asc' | 'desc'>('desc')

  // 메모
  const [memos, setMemos] = useState<DailyMemoType[]>([])
  // 차트 클릭으로 선택된 날짜
  const [memoTarget, setMemoTarget] = useState<{ date: string; version: number } | null>(null)
  const isNcaAdType =
    adTypeFilter === '신규 구매 고객 확보' ||
    (adTypeFilter === 'all' && adTypes.length === 1 && adTypes[0] === '신규 구매 고객 확보')

  // 기간 파라미터가 없거나 비정상인 경우 기본 14일로 보정
  useEffect(() => {
    if (isDateRangeReady) return

    const { from: defaultFrom, to: defaultTo } = getLastNDaysRangeKst(DEFAULT_RANGE_DAYS)
    const params = new URLSearchParams(searchParamsString)
    params.set('from', defaultFrom)
    params.set('to', defaultTo)

    router.replace(`${pathname}?${params.toString()}`)
  }, [isDateRangeReady, pathname, router, searchParamsString])

  // 지표 시계열 조회
  useEffect(() => {
    if (!isDateRangeReady) {
      setMetricSeries([])
      return
    }

    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    if (adTypeFilter && adTypeFilter !== 'all') q.set('adType', adTypeFilter)

    fetch(`/api/campaigns/${campaignId}/metrics?${q}`)
      .then((r) => (r.ok ? r.json() : { series: [] }))
      .then((d: { series: MetricSeries[] }) => setMetricSeries(d.series))
      .catch(() => setMetricSeries([]))
  }, [campaignId, from, to, adTypeFilter, isDateRangeReady])

  // 광고 데이터 조회
  useEffect(() => {
    if (!isDateRangeReady) {
      setRecords([])
      setTotal(0)
      setPlacementOptions([])
      return
    }

    const q = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    })
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    if (adTypeFilter && adTypeFilter !== 'all') q.set('adType', adTypeFilter)
    if (placementFilter && placementFilter !== 'all') q.set('placement', placementFilter)

    fetch(`/api/campaigns/${campaignId}/records?${q}`)
      .then((r) => (r.ok ? r.json() : { items: [], total: 0, placements: [] }))
      .then((d: { items: AdRecord[]; total: number; placements: string[] }) => {
        setRecords(d.items)
        setTotal(d.total)
        setPlacementOptions(d.placements)
        if (placementFilter !== 'all' && !d.placements.includes(placementFilter)) {
          setPlacementFilter('all')
        }
        if (d.items.length > 0) {
          setCampaignName((prev) => prev || d.items[0].campaignName)
        }
      })
      .catch(() => {
        setRecords([])
        setTotal(0)
        setPlacementOptions([])
      })
  }, [campaignId, page, pageSize, from, to, adTypeFilter, placementFilter, isDateRangeReady])

  useEffect(() => {
    setPlacementFilter('all')
    setPage(1)
  }, [campaignId, from, to, adTypeFilter])

  useEffect(() => {
    if (isNcaAdType) {
      setShowColumnMenu(false)
    }
  }, [isNcaAdType])

  // 비효율 키워드 조회
  useEffect(() => {
    if (!isDateRangeReady) {
      setKeywords([])
      setSelectedKeywords([])
      return
    }

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
  }, [campaignId, from, to, adTypeFilter, isDateRangeReady])

  // 메모 조회
  useEffect(() => {
    if (!isDateRangeReady) {
      setMemos([])
      return
    }

    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    const query = q.toString()
    const url = query
      ? `/api/campaigns/${campaignId}/memos?${query}`
      : `/api/campaigns/${campaignId}/memos`

    fetch(url)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: DailyMemoType[] }) => setMemos(d.items))
      .catch(() => setMemos([]))
  }, [campaignId, from, to, isDateRangeReady])

  // 캠페인 메타 (adTypes) 조회
  useEffect(() => {
    fetch('/api/campaigns')
      .then((r) => (r.ok ? r.json() : []))
      .then(
        (
          list: Array<{
            id: string
            name: string
            displayName: string
            isCustomName: boolean
            adTypes: string[]
          }>
        ) => {
          const found = list.find((c) => c.id === campaignId)
          if (found) {
            setCampaignName(found.name)
            setDisplayName(found.displayName)
            setAdTypes(found.adTypes)
          }
        }
      )
      .catch(() => {})
  }, [campaignId])

  // 페이지네이션
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const blockSize = 10
  const currentBlock = Math.floor((page - 1) / blockSize)
  const blockStartPage = currentBlock * blockSize + 1
  const blockEndPage = Math.min(totalPages, blockStartPage + blockSize - 1)
  const hasPrevBlock = blockStartPage > 1
  const hasNextBlock = blockEndPage < totalPages
  const pageNumbers = Array.from(
    { length: blockEndPage - blockStartPage + 1 },
    (_, idx) => blockStartPage + idx
  )

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortOrder('desc')
    }
    setPage(1)
  }

  const sortedRecords = useMemo(() => {
    const getSortValue = (record: AdRecord): number | null => {
      if (sortKey === 'date') {
        return new Date(record.date).getTime()
      }
      return record[sortKey] as number | null
    }

    return [...records].sort((a, b) => {
      const av = getSortValue(a)
      const bv = getSortValue(b)

      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1

      return sortOrder === 'asc' ? av - bv : bv - av
    })
  }, [records, sortKey, sortOrder])

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

  // 캠페인 표시명 저장
  async function handleSaveName() {
    const trimmed = editNameValue.trim()
    if (!trimmed) return
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: trimmed }),
      })
      if (!res.ok) throw new Error('저장에 실패했습니다')
      setDisplayName(trimmed)
      setIsEditingName(false)
      toast.success('캠페인 이름이 변경되었습니다')
    } catch {
      toast.error('이름 저장 중 오류가 발생했습니다')
    }
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

  async function handleDeleteCampaign() {
    if (isDeletingCampaign) return

    try {
      setIsDeletingCampaign(true)
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'DELETE',
      })
      const data = (await res.json().catch(() => null)) as { message?: string } | null
      if (!res.ok) {
        throw new Error(data?.message ?? '캠페인 삭제에 실패했습니다')
      }

      toast.success('캠페인이 삭제되었습니다')
      setIsDeleteDialogOpen(false)
      router.push('/dashboard')
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : '캠페인 삭제 중 오류가 발생했습니다'
      toast.error(message)
    } finally {
      setIsDeletingCampaign(false)
    }
  }

  // KPI 계산 — metricSeries 합산 (CTR/CVR/ROAS null 제외 평균)
  const kpiData = useMemo(() => {
    const totalAdCost = metricSeries.reduce((s, r) => s + r.adCost, 0)
    const totalRevenue = metricSeries.reduce((s, r) => s + r.totalRevenue, 0)
    const roasVals = metricSeries.map((r) => r.roas).filter((v): v is number => v !== null)
    const ctrVals = metricSeries.map((r) => r.ctr).filter((v): v is number => v !== null)
    const cvrVals = metricSeries.map((r) => r.cvr).filter((v): v is number => v !== null)
    const engagementRateVals = metricSeries
      .map((r) => r.engagementRate)
      .filter((v): v is number => v !== null)
    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null
    return {
      totalAdCost,
      totalRevenue,
      avgRoas: avg(roasVals),
      avgCtr: avg(ctrVals),
      avgCvr: avg(cvrVals),
      avgEngagementRate: avg(engagementRateVals),
    }
  }, [metricSeries])

  const kpiCards = isNcaAdType
    ? [
        {
          title: '총 광고비',
          value: `${kpiData.totalAdCost.toLocaleString('ko-KR')}원`,
          icon: DollarSign,
          color: 'text-orange-500',
        },
        {
          title: '총 매출액',
          value: `${kpiData.totalRevenue.toLocaleString('ko-KR')}원`,
          icon: ShoppingCart,
          color: 'text-emerald-600',
        },
        {
          title: '평균 ROAS',
          value: kpiData.avgRoas !== null ? `${kpiData.avgRoas.toFixed(2)}%` : '-',
          icon: TrendingUp,
          color: 'text-green-600',
        },
        {
          title: '평균 CTR',
          value: kpiData.avgCtr !== null ? `${kpiData.avgCtr.toFixed(2)}%` : '-',
          icon: MousePointerClick,
          color: 'text-blue-600',
        },
        {
          title: '평균 참여율',
          value:
            kpiData.avgEngagementRate !== null ? `${kpiData.avgEngagementRate.toFixed(2)}%` : '-',
          icon: Target,
          color: 'text-purple-600',
        },
      ]
    : [
        {
          title: '총 광고비',
          value: `${kpiData.totalAdCost.toLocaleString('ko-KR')}원`,
          icon: DollarSign,
          color: 'text-orange-500',
        },
        {
          title: '총 매출액',
          value: `${kpiData.totalRevenue.toLocaleString('ko-KR')}원`,
          icon: ShoppingCart,
          color: 'text-emerald-600',
        },
        {
          title: '평균 ROAS',
          value: kpiData.avgRoas !== null ? `${kpiData.avgRoas.toFixed(2)}%` : '-',
          icon: TrendingUp,
          color: 'text-green-600',
        },
        {
          title: '평균 CTR',
          value: kpiData.avgCtr !== null ? `${kpiData.avgCtr.toFixed(2)}%` : '-',
          icon: MousePointerClick,
          color: 'text-blue-600',
        },
        {
          title: '평균 CVR',
          value: kpiData.avgCvr !== null ? `${kpiData.avgCvr.toFixed(2)}%` : '-',
          icon: Target,
          color: 'text-purple-600',
        },
      ]

  // 빈 문자열 adType은 SelectItem value로 허용되지 않으므로 필터링
  const adTypeOptions = [
    { value: 'all', label: '전체' },
    ...adTypes.filter((t) => t.trim() !== '').map((t) => ({ value: t, label: t })),
  ]

  function handleTabChange(nextTab: string) {
    if (nextTab !== 'dashboard' && nextTab !== 'keywords' && nextTab !== 'addata') return

    const params = new URLSearchParams(searchParams.toString())
    if (nextTab === 'dashboard') params.delete('tab')
    else params.set('tab', nextTab)

    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  return (
    <div className="space-y-6">
      {/* 페이지 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {isEditingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName()
                  if (e.key === 'Escape') setIsEditingName(false)
                }}
                className="h-9 max-w-sm text-xl font-bold"
                autoFocus
              />
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleSaveName}>
                <Check className="h-4 w-4 text-green-600" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => setIsEditingName(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {displayName || campaignName || campaignId}
              </h1>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground"
                onClick={() => {
                  setEditNameValue(displayName || campaignName || campaignId)
                  setIsEditingName(true)
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {adTypes.map((t) => (
              <span
                key={t}
                className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {t}
              </span>
            ))}
            <p className="text-sm text-muted-foreground">캠페인 데이터를 분석합니다</p>
          </div>
        </div>
        <Button
          variant="destructive"
          size="sm"
          className="gap-1.5"
          onClick={() => setIsDeleteDialogOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          캠페인 삭제
        </Button>
      </div>

      {/* 공통 필터 바 */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <FilterBar adTypeOptions={adTypeOptions} showAdTypeFilter={adTypes.length > 1} />
        </CardContent>
      </Card>

      {/* 탭 영역 */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger
            value="dashboard"
            className="border border-transparent hover:border-border hover:bg-background/70"
          >
            대시보드
          </TabsTrigger>
          <TabsTrigger
            value="keywords"
            className="border border-transparent hover:border-border hover:bg-background/70"
          >
            키워드 분석
          </TabsTrigger>
          <TabsTrigger
            value="addata"
            className="border border-transparent hover:border-border hover:bg-background/70"
          >
            광고 데이터
          </TabsTrigger>
        </TabsList>

        {/* ── 대시보드 탭 ── */}
        <TabsContent value="dashboard" className="space-y-6">
          {/* KPI 카드 */}
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
                onChartClick={(date) =>
                  setMemoTarget((prev) => ({
                    date,
                    version: (prev?.version ?? 0) + 1,
                  }))
                }
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
                targetDate={memoTarget?.date ?? null}
                targetDateVersion={memoTarget?.version ?? 0}
              />
            </CardContent>
          </Card>
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

        {/* ── 광고 데이터 탭 ── */}
        <TabsContent value="addata" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              총 <span className="font-medium text-foreground">{total}</span>개 행
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={placementFilter}
                onValueChange={(value) => {
                  setPlacementFilter(value)
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-40 text-sm">
                  <SelectValue placeholder="노출 지면" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 지면</SelectItem>
                  {placementOptions.map((placement) => (
                    <SelectItem key={placement} value={placement}>
                      {placement}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {!isNcaAdType && (
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
              )}

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
                  <SelectItem value="25">25행</SelectItem>
                  <SelectItem value="50">50행</SelectItem>
                  <SelectItem value="100">100행</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    {isNcaAdType ? (
                      <TableRow>
                        <TableHead
                          className="w-24 cursor-pointer select-none"
                          onClick={() => handleSort('date')}
                        >
                          <span className="flex items-center">
                            날짜
                            <SortIcon column="date" sortKey={sortKey} sortOrder={sortOrder} />
                          </span>
                        </TableHead>
                        <TableHead className="w-24 min-w-24">광고 노출 지면</TableHead>
                        <TableHead className="w-52 min-w-52">상품명</TableHead>
                        <TableHead className="w-28 min-w-28">옵션명</TableHead>
                        <TableHead className="w-24 min-w-24">소재유형</TableHead>
                        <TableHead className="w-28">키워드</TableHead>
                        <TableHead
                          className="cursor-pointer text-right select-none"
                          onClick={() => handleSort('roas')}
                        >
                          <span className="flex items-center justify-end">
                            ROAS
                            <SortIcon column="roas" sortKey={sortKey} sortOrder={sortOrder} />
                          </span>
                        </TableHead>
                        <TableHead className="text-right">참여율</TableHead>
                        <TableHead
                          className="cursor-pointer text-right select-none"
                          onClick={() => handleSort('ctr')}
                        >
                          <span className="flex items-center justify-end">
                            CTR
                            <SortIcon column="ctr" sortKey={sortKey} sortOrder={sortOrder} />
                          </span>
                        </TableHead>
                        <TableHead
                          className="cursor-pointer text-right select-none"
                          onClick={() => handleSort('adCost')}
                        >
                          <span className="flex items-center justify-end">
                            광고비
                            <SortIcon column="adCost" sortKey={sortKey} sortOrder={sortOrder} />
                          </span>
                        </TableHead>
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
                        <TableHead
                          className="cursor-pointer text-right select-none"
                          onClick={() => handleSort('engagements')}
                        >
                          <span className="flex items-center justify-end">
                            참여수
                            <SortIcon
                              column="engagements"
                              sortKey={sortKey}
                              sortOrder={sortOrder}
                            />
                          </span>
                        </TableHead>
                        <TableHead
                          className="cursor-pointer text-right select-none"
                          onClick={() => handleSort('clicks')}
                        >
                          <span className="flex items-center justify-end">
                            클릭수
                            <SortIcon column="clicks" sortKey={sortKey} sortOrder={sortOrder} />
                          </span>
                        </TableHead>
                        <TableHead
                          className="cursor-pointer text-right select-none"
                          onClick={() => handleSort('revenue1d')}
                        >
                          <span className="flex items-center justify-end">
                            매출 금액
                            <SortIcon column="revenue1d" sortKey={sortKey} sortOrder={sortOrder} />
                          </span>
                        </TableHead>
                      </TableRow>
                    ) : (
                      <TableRow>
                        <TableHead
                          className="w-24 cursor-pointer select-none"
                          onClick={() => handleSort('date')}
                        >
                          <span className="flex items-center">
                            날짜
                            <SortIcon column="date" sortKey={sortKey} sortOrder={sortOrder} />
                          </span>
                        </TableHead>
                        {visibleColumns.has('placement') && (
                          <TableHead className="w-24 min-w-24">광고 노출 지면</TableHead>
                        )}
                        {visibleColumns.has('parsedProductName') && (
                          <TableHead className="w-52 min-w-52">상품명</TableHead>
                        )}
                        {visibleColumns.has('parsedOptionName') && (
                          <TableHead className="w-28 min-w-28">옵션명</TableHead>
                        )}
                        <TableHead className="w-28">키워드</TableHead>
                        <TableHead
                          className="cursor-pointer text-right select-none"
                          onClick={() => handleSort('roas')}
                        >
                          <span className="flex items-center justify-end">
                            ROAS
                            <SortIcon column="roas" sortKey={sortKey} sortOrder={sortOrder} />
                          </span>
                        </TableHead>
                        <TableHead
                          className="cursor-pointer text-right select-none"
                          onClick={() => handleSort('cvr')}
                        >
                          <span className="flex items-center justify-end">
                            CVR
                            <SortIcon column="cvr" sortKey={sortKey} sortOrder={sortOrder} />
                          </span>
                        </TableHead>
                        <TableHead
                          className="cursor-pointer text-right select-none"
                          onClick={() => handleSort('ctr')}
                        >
                          <span className="flex items-center justify-end">
                            CTR
                            <SortIcon column="ctr" sortKey={sortKey} sortOrder={sortOrder} />
                          </span>
                        </TableHead>
                        <TableHead
                          className="cursor-pointer text-right select-none"
                          onClick={() => handleSort('adCost')}
                        >
                          <span className="flex items-center justify-end">
                            광고비
                            <SortIcon column="adCost" sortKey={sortKey} sortOrder={sortOrder} />
                          </span>
                        </TableHead>
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
                        {visibleColumns.has('engagements') && (
                          <TableHead
                            className="cursor-pointer text-right select-none"
                            onClick={() => handleSort('engagements')}
                          >
                            <span className="flex items-center justify-end">
                              참여수
                              <SortIcon
                                column="engagements"
                                sortKey={sortKey}
                                sortOrder={sortOrder}
                              />
                            </span>
                          </TableHead>
                        )}
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
                        {visibleColumns.has('orders1d') && (
                          <TableHead
                            className="cursor-pointer text-right select-none"
                            onClick={() => handleSort('orders1d')}
                          >
                            <span className="flex items-center justify-end">
                              주문 건수
                              <SortIcon column="orders1d" sortKey={sortKey} sortOrder={sortOrder} />
                            </span>
                          </TableHead>
                        )}
                        {visibleColumns.has('revenue1d') && (
                          <TableHead
                            className="cursor-pointer text-right select-none"
                            onClick={() => handleSort('revenue1d')}
                          >
                            <span className="flex items-center justify-end">
                              매출 금액
                              <SortIcon
                                column="revenue1d"
                                sortKey={sortKey}
                                sortOrder={sortOrder}
                              />
                            </span>
                          </TableHead>
                        )}
                      </TableRow>
                    )}
                  </TableHeader>
                  <TableBody>
                    {sortedRecords.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={isNcaAdType ? 14 : 20}
                          className="py-12 text-center text-sm text-muted-foreground"
                        >
                          필터 조건에 맞는 데이터가 없습니다
                        </TableCell>
                      </TableRow>
                    ) : isNcaAdType ? (
                      sortedRecords.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell className="text-sm">{record.date}</TableCell>
                          <TruncatedCell
                            text={record.placement}
                            className="w-24 min-w-24 truncate text-sm text-muted-foreground"
                          />
                          <TruncatedCell
                            text={record.parsedProductName}
                            className="w-52 max-w-52 min-w-52 truncate text-sm"
                          />
                          <TruncatedCell
                            text={record.parsedOptionName}
                            className="w-28 min-w-28 truncate text-sm text-muted-foreground"
                          />
                          <TableCell className="text-sm text-muted-foreground">
                            {record.material ?? '-'}
                          </TableCell>
                          <TruncatedCell
                            text={record.keyword}
                            className="max-w-28 truncate text-sm text-muted-foreground"
                          />
                          <TableCell className="text-right text-sm font-medium">
                            {fmt(record.roas, '%')}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {fmt(record.engagementRate, '%')}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {fmt(record.ctr, '%')}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {record.adCost.toLocaleString('ko-KR')}원
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {record.impressions.toLocaleString('ko-KR')}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {record.engagements !== null
                              ? record.engagements.toLocaleString('ko-KR')
                              : '-'}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {record.clicks.toLocaleString('ko-KR')}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {record.revenue1d.toLocaleString('ko-KR')}원
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      sortedRecords.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell className="text-sm">{record.date}</TableCell>
                          {visibleColumns.has('placement') && (
                            <TruncatedCell
                              text={record.placement}
                              className="w-24 min-w-24 truncate text-sm text-muted-foreground"
                            />
                          )}
                          {visibleColumns.has('parsedProductName') && (
                            <TruncatedCell
                              text={record.parsedProductName}
                              className="w-52 max-w-52 min-w-52 truncate text-sm"
                            />
                          )}
                          {visibleColumns.has('parsedOptionName') && (
                            <TruncatedCell
                              text={record.parsedOptionName}
                              className="w-28 min-w-28 truncate text-sm text-muted-foreground"
                            />
                          )}
                          <TruncatedCell
                            text={record.keyword}
                            className="max-w-28 truncate text-sm text-muted-foreground"
                          />
                          <TableCell className="text-right text-sm font-medium">
                            {fmt(record.roas, '%')}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {fmt(record.cvr, '%')}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {fmt(record.ctr, '%')}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {record.adCost.toLocaleString('ko-KR')}원
                          </TableCell>
                          {visibleColumns.has('impressions') && (
                            <TableCell className="text-right text-sm">
                              {record.impressions.toLocaleString('ko-KR')}
                            </TableCell>
                          )}
                          {visibleColumns.has('engagements') && (
                            <TableCell className="text-right text-sm">
                              {record.engagements !== null
                                ? record.engagements.toLocaleString('ko-KR')
                                : '-'}
                            </TableCell>
                          )}
                          {visibleColumns.has('clicks') && (
                            <TableCell className="text-right text-sm">
                              {record.clicks.toLocaleString('ko-KR')}
                            </TableCell>
                          )}
                          {visibleColumns.has('orders1d') && (
                            <TableCell className="text-right text-sm">
                              {record.orders1d.toLocaleString('ko-KR')}
                            </TableCell>
                          )}
                          {visibleColumns.has('revenue1d') && (
                            <TableCell className="text-right text-sm">
                              {record.revenue1d.toLocaleString('ko-KR')}원
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
            <div className="flex flex-col items-center gap-2">
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                >
                  처음
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(1, blockStartPage - blockSize))}
                  disabled={!hasPrevBlock}
                >
                  이전 10
                </Button>
                {pageNumbers.map((pageNumber) => (
                  <Button
                    key={pageNumber}
                    variant={pageNumber === page ? 'default' : 'outline'}
                    size="sm"
                    className="min-w-9 font-medium"
                    onClick={() => setPage(pageNumber)}
                  >
                    {pageNumber}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, blockEndPage + 1))}
                  disabled={!hasNextBlock}
                >
                  다음 10
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                >
                  마지막
                </Button>
              </div>
              <span className="text-xs text-muted-foreground">
                {blockStartPage}-{blockEndPage} / 총 {totalPages}페이지
              </span>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!isDeletingCampaign) {
            setIsDeleteDialogOpen(open)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>캠페인을 삭제하시겠습니까?</DialogTitle>
            <DialogDescription>
              선택한 캠페인의 광고 데이터, 메모, 캠페인 설정이 모두 삭제됩니다.
              <br />
              삭제된 데이터는 복구할 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isDeletingCampaign}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCampaign}
              disabled={isDeletingCampaign}
            >
              {isDeletingCampaign ? '삭제 중...' : '삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
