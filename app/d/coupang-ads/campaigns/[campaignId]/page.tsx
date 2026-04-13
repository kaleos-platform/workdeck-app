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
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Minus,
  Columns3,
  Pencil,
  Check,
  X,
  Trash2,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { FilterBar } from '@/components/dashboard/filter-bar'
import { CampaignChart } from '@/components/dashboard/campaign-chart'
import { DailyMemo } from '@/components/dashboard/daily-memo'
import { CampaignTargetSection } from '@/components/dashboard/campaign-target-section'
import { ProductTrendsTable } from '@/components/dashboard/product-trends-table'
import { getDaysAgoStrKst, isYmdDateString } from '@/lib/date-range'
import { COUPANG_ADS_BASE_PATH } from '@/lib/deck-routes'
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
type KeywordSortKey = 'keyword' | 'adCost' | 'ctr' | 'cvr' | 'roas' | 'orders1d' | 'revenue1d'
type TabValue = 'dashboard' | 'keywords' | 'products' | 'addata' | 'trends'

// 상품 분석 탭 아이템 타입
type ProductItem = {
  productName: string
  parsedProductName: string
  optionName: string | null
  optionId: string | null
  adCost: number
  adCostShare: number
  impressions: number
  clicks: number
  ctr: number | null
  cvr: number | null
  roas: number | null
  revenue1d: number
  orders1d: number
  removedAt: string | null
}

// 상품 분석 탭 정렬 컬럼
type ProductSortKey = 'adCost' | 'ctr' | 'cvr' | 'roas' | 'orders1d' | 'revenue1d'
type RemovalCancelContext =
  | { type: 'keyword'; keywords: string[] }
  | { type: 'product'; items: ProductItem[] }
  | null

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

// 이전 기간 대비 증감율 계산 (소수점 1자리, 이전 값이 0이면 null)
function calcDiff(current: number, prev: number): number | null {
  if (prev === 0) return null
  return Math.round(((current - prev) / prev) * 1000) / 10
}

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

function ProdSortIcon({
  column,
  sortKey,
  sortOrder,
}: {
  column: ProductSortKey
  sortKey: ProductSortKey
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
    tab === 'keywords' || tab === 'addata' || tab === 'dashboard' || tab === 'products' || tab === 'trends'
      ? tab
      : 'dashboard'

  // 캠페인 메타 정보
  const [campaignName, setCampaignName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [adTypes, setAdTypes] = useState<string[]>([])

  // 캠페인명 인라인 편집
  const [isEditingName, setIsEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState('')

  // 지표 시계열
  const [metricSeries, setMetricSeries] = useState<MetricSeries[]>([])
  // 이전 동일 기간 시계열
  const [prevMetricSeries, setPrevMetricSeries] = useState<MetricSeries[]>([])

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

  // 키워드 복사 완료 다이얼로그
  const [isCopyDoneOpen, setIsCopyDoneOpen] = useState(false)
  const [copiedKeywords, setCopiedKeywords] = useState<string[]>([])
  const [isSavingMemo, setIsSavingMemo] = useState(false)
  // 메모 작성 UI (날짜/내용 입력)
  const [memoDate, setMemoDate] = useState('')
  const [memoContent, setMemoContent] = useState('')
  const [isRemovalCancelConfirmOpen, setIsRemovalCancelConfirmOpen] = useState(false)
  const [removalCancelContext, setRemovalCancelContext] = useState<RemovalCancelContext>(null)
  const [isWritingCancelMemo, setIsWritingCancelMemo] = useState(true)
  const [isCancellingRemoval, setIsCancellingRemoval] = useState(false)
  const [isCancelMemoDialogOpen, setIsCancelMemoDialogOpen] = useState(false)
  const [cancelMemoDate, setCancelMemoDate] = useState('')
  const [cancelMemoContent, setCancelMemoContent] = useState('')
  const [isSavingCancelMemo, setIsSavingCancelMemo] = useState(false)

  // 상품 분석 탭 상태
  const [productItems, setProductItems] = useState<ProductItem[]>([])
  const [productLoading, setProductLoading] = useState(false)
  const [productTotalAdCost, setProductTotalAdCost] = useState(0)
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]) // key = "productName|optionId"
  const [productFilter, setProductFilter] = useState('')
  const [productExcludeRemoved, setProductExcludeRemoved] = useState(false)
  const [isProductRemoveDialogOpen, setIsProductRemoveDialogOpen] = useState(false)
  const [productMemoDate, setProductMemoDate] = useState('')
  const [productMemoContent, setProductMemoContent] = useState('')
  const [isSavingProductMemo, setIsSavingProductMemo] = useState(false)
  const [productRemovingItems, setProductRemovingItems] = useState<ProductItem[]>([])

  // 키워드
  const [keywords, setKeywords] = useState<InefficientKeyword[]>([])
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([])
  // 키워드 탭 정렬
  const [kwSortBy, setKwSortBy] = useState<KeywordSortKey>('adCost')
  const [kwSortOrder, setKwSortOrder] = useState<'asc' | 'desc'>('desc')
  // 키워드 탭 필터 ('all' | 'zero': 광고비·주문 수 모두 0 | 'orders': 주문 발생)
  const [kwFilter, setKwFilter] = useState<'all' | 'zero' | 'orders'>('all')
  // 제거된 키워드 숨기기 토글
  const [kwExcludeRemoved, setKwExcludeRemoved] = useState(false)
  // 키워드 탭 검색
  const [kwSearch, setKwSearch] = useState('')

  // 상품 탭 정렬
  const [productSortBy, setProductSortBy] = useState<ProductSortKey>('adCost')
  const [productSortOrder, setProductSortOrder] = useState<'asc' | 'desc'>('desc')
  // 상품 탭 필터 모드
  const [productFilterMode, setProductFilterMode] = useState<'all' | 'zero' | 'orders'>('all')

  // 메모
  const [memos, setMemos] = useState<DailyMemoType[]>([])
  // 차트 클릭으로 선택된 날짜
  const [memoTarget, setMemoTarget] = useState<{ date: string; version: number } | null>(null)
  const isNcaAdType =
    adTypeFilter === '신규 구매 고객 확보' ||
    (adTypeFilter === 'all' && adTypes.length === 1 && adTypes[0] === '신규 구매 고객 확보')

  // 기간 파라미터가 없거나 비정상인 경우 기본값(어제 기준 7일)으로 보정
  useEffect(() => {
    if (isDateRangeReady) return

    const params = new URLSearchParams(searchParamsString)
    params.set('from', getDaysAgoStrKst(7))
    params.set('to', getDaysAgoStrKst(1))

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

  // 이전 동일 기간 지표 조회
  useEffect(() => {
    if (!isDateRangeReady || !from || !to) {
      setPrevMetricSeries([])
      return
    }
    // 현재 기간 일수 계산 후 동일 길이만큼 이전 기간 설정
    const fromMs = new Date(from + 'T00:00:00').getTime()
    const toMs = new Date(to + 'T00:00:00').getTime()
    const days = Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24)) + 1
    const prevToMs = fromMs - 24 * 60 * 60 * 1000
    const prevFromMs = prevToMs - (days - 1) * 24 * 60 * 60 * 1000
    const prevFrom = new Date(prevFromMs).toISOString().split('T')[0]
    const prevTo = new Date(prevToMs).toISOString().split('T')[0]

    const q = new URLSearchParams({ from: prevFrom, to: prevTo })
    if (adTypeFilter && adTypeFilter !== 'all') q.set('adType', adTypeFilter)

    fetch(`/api/campaigns/${campaignId}/metrics?${q}`)
      .then((r) => (r.ok ? r.json() : { series: [] }))
      .then((d: { series: MetricSeries[] }) => setPrevMetricSeries(d.series))
      .catch(() => setPrevMetricSeries([]))
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
        setSelectedKeywords([])
        setKwFilter('all') // 날짜/adType 변경 시 필터 초기화
        setKwExcludeRemoved(false) // 기간 변경 시 제거 제외 토글도 초기화
      })
      .catch(() => setKeywords([]))
  }, [campaignId, from, to, adTypeFilter, isDateRangeReady])

  // 메모 조회
  useEffect(() => {
    if (!isDateRangeReady) {
      setMemos([])
      return
    }

    fetch(`/api/campaigns/${campaignId}/memos`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: DailyMemoType[] }) => setMemos(d.items))
      .catch(() => setMemos([]))
  }, [campaignId, isDateRangeReady])

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

  // 상품 탭 정렬
  function handleProductSort(key: ProductSortKey) {
    if (productSortBy === key) {
      setProductSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setProductSortBy(key)
      setProductSortOrder('desc')
    }
    setSelectedProducts([])
  }

  // 키워드 탭 필터링
  const filteredKeywords = useMemo(() => {
    let result = keywords
    if (kwExcludeRemoved) result = result.filter((kw) => kw.removedAt === null)
    if (kwSearch.trim())
      result = result.filter((kw) =>
        kw.keyword.toLowerCase().includes(kwSearch.trim().toLowerCase())
      )
    if (kwFilter === 'zero') return result.filter((kw) => kw.orders1d === 0 && kw.adCost > 0)
    if (kwFilter === 'orders') return result.filter((kw) => kw.orders1d >= 1)
    return result
  }, [keywords, kwFilter, kwExcludeRemoved, kwSearch])

  // 키워드 클라이언트 사이드 정렬
  const sortedKeywords = useMemo(() => {
    return [...filteredKeywords].sort((a, b) => {
      if (kwSortBy === 'keyword') {
        const cmp = a.keyword.localeCompare(b.keyword, 'ko')
        return kwSortOrder === 'asc' ? cmp : -cmp
      }
      const av = (a[kwSortBy] as number | null) ?? -Infinity
      const bv = (b[kwSortBy] as number | null) ?? -Infinity
      return kwSortOrder === 'asc' ? av - bv : bv - av
    })
  }, [filteredKeywords, kwSortBy, kwSortOrder])

  // 상품 탭 필터링 + 정렬
  const filteredSortedProducts = useMemo(() => {
    let result = productItems
    if (productExcludeRemoved) result = result.filter((p) => !p.removedAt)
    if (productFilter.trim())
      result = result.filter((p) =>
        p.parsedProductName.toLowerCase().includes(productFilter.trim().toLowerCase())
      )
    if (productFilterMode === 'zero')
      result = result.filter((p) => p.adCost > 0 && p.orders1d === 0)
    if (productFilterMode === 'orders') result = result.filter((p) => p.orders1d > 0)
    return [...result].sort((a, b) => {
      const av = (a[productSortBy] as number | null) ?? -Infinity
      const bv = (b[productSortBy] as number | null) ?? -Infinity
      return productSortOrder === 'asc' ? av - bv : bv - av
    })
  }, [
    productItems,
    productExcludeRemoved,
    productFilter,
    productFilterMode,
    productSortBy,
    productSortOrder,
  ])

  // 키워드 다중 선택 (필터링된 키워드 기준)
  const allKeywordNames = filteredKeywords.map((k) => k.keyword)
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
    setCopiedKeywords([...selectedKeywords])
    setMemoDate(getTodayKst())
    setMemoContent(`키워드 제거: ${selectedKeywords.join(', ')}`)
    setIsCopyDoneOpen(true)
  }

  // 오늘 날짜 KST YYYY-MM-DD
  function getTodayKst(): string {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]
  }

  function upsertMemo(saved: DailyMemoType) {
    setMemos((prev) => {
      const without = prev.filter((m) => m.date !== saved.date)
      return [saved, ...without]
    })
  }

  async function appendMemo(dateToUse: string, newEntry: string): Promise<DailyMemoType> {
    const res = await fetch(`/api/campaigns/${campaignId}/memos?from=${dateToUse}&to=${dateToUse}`)
    const data = (res.ok ? await res.json() : { items: [] }) as {
      items: DailyMemoType[]
    }
    const existing = data.items.find((m) => m.date === dateToUse)
    const content = existing ? `${existing.content}\n${newEntry}` : newEntry

    const saveRes = await fetch(`/api/campaigns/${campaignId}/memos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateToUse, content }),
    })
    if (!saveRes.ok) throw new Error('메모 저장 실패')

    const saved = (await saveRes.json()) as DailyMemoType
    upsertMemo(saved)
    return saved
  }

  function buildProductCancelMemo(items: ProductItem[]): string {
    const lines = items.map((p) => {
      const productName = p.parsedProductName || p.productName
      const optionName = p.optionName ?? '-'
      const optionId = p.optionId ?? '-'
      return `- ${productName} ${optionName}: ${optionId}`
    })
    return `상품 제거 취소:\n${lines.join('\n')}`
  }

  // 키워드 복사 후 메모 저장 + 제거 상태 기록
  async function handleSaveKeywordMemo() {
    if (isSavingMemo) return
    setIsSavingMemo(true)
    try {
      const dateToUse = memoDate || getTodayKst()
      const newEntry = memoContent.trim() || `키워드 제거: ${copiedKeywords.join(', ')}`

      // 메모 저장 + 제거 상태 기록 병렬 처리
      const [, statusRes] = await Promise.all([
        appendMemo(dateToUse, newEntry),
        fetch(`/api/campaigns/${campaignId}/keyword-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keywords: copiedKeywords }),
        }),
      ])

      // 제거 상태 저장 성공 시 키워드 목록 업데이트
      if (statusRes.ok) {
        const removedDate = dateToUse
        setKeywords((prev) =>
          prev.map((kw) =>
            copiedKeywords.includes(kw.keyword) ? { ...kw, removedAt: removedDate } : kw
          )
        )
      }

      toast.success('메모에 키워드가 기록되었습니다')
      setIsCopyDoneOpen(false)
      setSelectedKeywords([])
    } catch {
      toast.error('메모 저장 중 오류가 발생했습니다')
    } finally {
      setIsSavingMemo(false)
    }
  }

  function openKeywordCancelConfirm(keywordsToCancel: string[]) {
    if (keywordsToCancel.length === 0) return
    setRemovalCancelContext({ type: 'keyword', keywords: keywordsToCancel })
    setIsWritingCancelMemo(true)
    setIsRemovalCancelConfirmOpen(true)
  }

  // 키워드 제거 상태 취소 확인창 열기
  function handleCancelRemoval() {
    const removedSelected = selectedKeywords.filter(
      (kw) => keywords.find((k) => k.keyword === kw)?.removedAt
    )
    openKeywordCancelConfirm(removedSelected)
  }

  // 개별 키워드 제거 버튼 클릭 → 클립보드 복사 + 팝업 열기
  function handleSingleKeywordRemove(keyword: string) {
    navigator.clipboard.writeText(keyword)
    setCopiedKeywords([keyword])
    setMemoDate(getTodayKst())
    setMemoContent(`키워드 제거: ${keyword}`)
    setIsCopyDoneOpen(true)
  }

  // 개별 키워드 제거 취소
  function handleSingleCancelRemoval(keyword: string) {
    openKeywordCancelConfirm([keyword])
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

  // 상품 분석 데이터 조회
  useEffect(() => {
    if (activeTab !== 'products' || !isDateRangeReady) {
      if (activeTab !== 'products') setProductItems([])
      return
    }

    setProductLoading(true)
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    if (adTypeFilter && adTypeFilter !== 'all') q.set('adType', adTypeFilter)

    fetch(`/api/campaigns/${campaignId}/product-analysis?${q}`)
      .then((r) => (r.ok ? r.json() : { items: [], totalAdCost: 0 }))
      .then((d: { items: ProductItem[]; totalAdCost: number }) => {
        setProductItems(d.items)
        setProductTotalAdCost(d.totalAdCost)
        setSelectedProducts([])
      })
      .catch(() => {
        setProductItems([])
        setProductTotalAdCost(0)
      })
      .finally(() => setProductLoading(false))
  }, [activeTab, campaignId, from, to, adTypeFilter, isDateRangeReady])

  // 상품 제거 팝업 열기
  function openProductRemoveDialog(items: ProductItem[]) {
    const lines = items.map(
      (p) => `- ${p.parsedProductName} ${p.optionName ?? '-'}: ${p.optionId ?? '-'}`
    )
    const content = `상품 제거:\n${lines.join('\n')}`
    setProductRemovingItems(items)
    setProductMemoDate(getTodayKst())
    setProductMemoContent(content)
    setIsProductRemoveDialogOpen(true)
  }

  // 상품 제거 확정 (메모 저장 + product-status POST)
  async function handleSaveProductMemo() {
    if (isSavingProductMemo) return
    setIsSavingProductMemo(true)
    try {
      const dateToUse = productMemoDate || getTodayKst()
      const newEntry = productMemoContent.trim()

      const [, statusRes] = await Promise.all([
        appendMemo(dateToUse, newEntry),
        fetch(`/api/campaigns/${campaignId}/product-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: productRemovingItems.map((p) => ({
              productName: p.productName,
              optionId: p.optionId ?? '',
            })),
          }),
        }),
      ])

      if (statusRes.ok) {
        const removedDate = dateToUse
        setProductItems((prev) =>
          prev.map((p) => {
            const isRemoving = productRemovingItems.some(
              (r) => r.productName === p.productName && (r.optionId ?? '') === (p.optionId ?? '')
            )
            return isRemoving ? { ...p, removedAt: removedDate } : p
          })
        )
      }

      toast.success('상품 제거 기록이 저장되었습니다')
      setIsProductRemoveDialogOpen(false)
      setSelectedProducts([])
    } catch {
      toast.error('저장 중 오류가 발생했습니다')
    } finally {
      setIsSavingProductMemo(false)
    }
  }

  function openProductCancelConfirm(items: ProductItem[]) {
    if (items.length === 0) return
    setRemovalCancelContext({ type: 'product', items })
    setIsWritingCancelMemo(true)
    setIsRemovalCancelConfirmOpen(true)
  }

  function handleProductCancelRemoval(product: ProductItem) {
    openProductCancelConfirm([product])
  }

  function handleSelectedProductCancelRemoval() {
    const removedSelected = productItems.filter((p) => {
      const key = `${p.productName}|${p.optionId ?? ''}`
      return selectedProducts.includes(key) && !!p.removedAt
    })
    openProductCancelConfirm(removedSelected)
  }

  async function handleConfirmRemovalCancel() {
    if (!removalCancelContext) return
    setIsCancellingRemoval(true)
    try {
      if (removalCancelContext.type === 'keyword') {
        const res = await fetch(
          `/api/campaigns/${campaignId}/keyword-status?keywords=${encodeURIComponent(removalCancelContext.keywords.join(','))}`,
          { method: 'DELETE' }
        )
        if (!res.ok) throw new Error('제거 취소 실패')

        setKeywords((prev) =>
          prev.map((kw) =>
            removalCancelContext.keywords.includes(kw.keyword) ? { ...kw, removedAt: null } : kw
          )
        )
        toast.success(`${removalCancelContext.keywords.length}개 키워드 제거 상태가 취소되었습니다`)
      } else {
        await Promise.all(
          removalCancelContext.items.map(async (item) => {
            const url = `/api/campaigns/${campaignId}/product-status?productName=${encodeURIComponent(item.productName)}&optionId=${encodeURIComponent(item.optionId ?? '')}`
            const res = await fetch(url, { method: 'DELETE' })
            if (!res.ok) throw new Error('제거 취소 실패')
          })
        )

        const canceledKeys = new Set(
          removalCancelContext.items.map((item) => `${item.productName}|${item.optionId ?? ''}`)
        )
        setProductItems((prev) =>
          prev.map((p) => {
            const key = `${p.productName}|${p.optionId ?? ''}`
            return canceledKeys.has(key) ? { ...p, removedAt: null } : p
          })
        )
        toast.success(`${removalCancelContext.items.length}개 상품 제거 상태가 취소되었습니다`)
      }

      setIsRemovalCancelConfirmOpen(false)
      if (!isWritingCancelMemo) {
        setRemovalCancelContext(null)
        return
      }

      const content =
        removalCancelContext.type === 'keyword'
          ? `키워드 제거 취소: ${removalCancelContext.keywords.join(', ')}`
          : buildProductCancelMemo(removalCancelContext.items)
      setCancelMemoDate(getTodayKst())
      setCancelMemoContent(content)
      setIsCancelMemoDialogOpen(true)
    } catch {
      toast.error('제거 취소 중 오류가 발생했습니다')
    } finally {
      setIsCancellingRemoval(false)
    }
  }

  async function handleSaveCancelMemo() {
    if (isSavingCancelMemo) return
    if (!cancelMemoContent.trim()) {
      toast.error('메모 내용을 입력해주세요')
      return
    }
    setIsSavingCancelMemo(true)
    try {
      const dateToUse = cancelMemoDate || getTodayKst()
      await appendMemo(dateToUse, cancelMemoContent.trim())
      toast.success('제거 취소 메모가 저장되었습니다')
      setIsCancelMemoDialogOpen(false)
      setRemovalCancelContext(null)
    } catch {
      toast.error('메모 저장 중 오류가 발생했습니다')
    } finally {
      setIsSavingCancelMemo(false)
    }
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
      router.push(COUPANG_ADS_BASE_PATH)
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

  // 이전 동일 기간 KPI 집계
  const prevKpiData = useMemo(() => {
    if (prevMetricSeries.length === 0) return null
    const totalAdCost = prevMetricSeries.reduce((s, r) => s + r.adCost, 0)
    const totalRevenue = prevMetricSeries.reduce((s, r) => s + r.totalRevenue, 0)
    const roasVals = prevMetricSeries.map((r) => r.roas).filter((v): v is number => v !== null)
    const ctrVals = prevMetricSeries.map((r) => r.ctr).filter((v): v is number => v !== null)
    const cvrVals = prevMetricSeries.map((r) => r.cvr).filter((v): v is number => v !== null)
    const engRateVals = prevMetricSeries
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
      avgEngagementRate: avg(engRateVals),
    }
  }, [prevMetricSeries])

  const kpiCards = isNcaAdType
    ? [
        {
          title: '총 광고비',
          value: `${kpiData.totalAdCost.toLocaleString('ko-KR')}원`,
          icon: DollarSign,
          color: 'text-orange-500',
          isPositive: false,
          diff: prevKpiData ? calcDiff(kpiData.totalAdCost, prevKpiData.totalAdCost) : null,
          prevValue: prevKpiData ? `${prevKpiData.totalAdCost.toLocaleString('ko-KR')}원` : null,
        },
        {
          title: '총 매출액',
          value: `${kpiData.totalRevenue.toLocaleString('ko-KR')}원`,
          icon: ShoppingCart,
          color: 'text-emerald-600',
          isPositive: true,
          diff: prevKpiData ? calcDiff(kpiData.totalRevenue, prevKpiData.totalRevenue) : null,
          prevValue: prevKpiData ? `${prevKpiData.totalRevenue.toLocaleString('ko-KR')}원` : null,
        },
        {
          title: '평균 ROAS',
          value: kpiData.avgRoas !== null ? `${kpiData.avgRoas.toFixed(2)}%` : '-',
          icon: TrendingUp,
          color: 'text-green-600',
          isPositive: true,
          diff:
            kpiData.avgRoas !== null && prevKpiData?.avgRoas != null
              ? calcDiff(kpiData.avgRoas, prevKpiData.avgRoas)
              : null,
          prevValue: prevKpiData?.avgRoas != null ? `${prevKpiData.avgRoas.toFixed(2)}%` : null,
        },
        {
          title: '평균 CTR',
          value: kpiData.avgCtr !== null ? `${kpiData.avgCtr.toFixed(2)}%` : '-',
          icon: MousePointerClick,
          color: 'text-blue-600',
          isPositive: true,
          diff:
            kpiData.avgCtr !== null && prevKpiData?.avgCtr != null
              ? calcDiff(kpiData.avgCtr, prevKpiData.avgCtr)
              : null,
          prevValue: prevKpiData?.avgCtr != null ? `${prevKpiData.avgCtr.toFixed(2)}%` : null,
        },
        {
          title: '평균 참여율',
          value:
            kpiData.avgEngagementRate !== null ? `${kpiData.avgEngagementRate.toFixed(2)}%` : '-',
          icon: Target,
          color: 'text-purple-600',
          isPositive: true,
          diff:
            kpiData.avgEngagementRate !== null && prevKpiData?.avgEngagementRate != null
              ? calcDiff(kpiData.avgEngagementRate, prevKpiData.avgEngagementRate)
              : null,
          prevValue:
            prevKpiData?.avgEngagementRate != null
              ? `${prevKpiData.avgEngagementRate.toFixed(2)}%`
              : null,
        },
      ]
    : [
        {
          title: '총 광고비',
          value: `${kpiData.totalAdCost.toLocaleString('ko-KR')}원`,
          icon: DollarSign,
          color: 'text-orange-500',
          isPositive: false,
          diff: prevKpiData ? calcDiff(kpiData.totalAdCost, prevKpiData.totalAdCost) : null,
          prevValue: prevKpiData ? `${prevKpiData.totalAdCost.toLocaleString('ko-KR')}원` : null,
        },
        {
          title: '총 매출액',
          value: `${kpiData.totalRevenue.toLocaleString('ko-KR')}원`,
          icon: ShoppingCart,
          color: 'text-emerald-600',
          isPositive: true,
          diff: prevKpiData ? calcDiff(kpiData.totalRevenue, prevKpiData.totalRevenue) : null,
          prevValue: prevKpiData ? `${prevKpiData.totalRevenue.toLocaleString('ko-KR')}원` : null,
        },
        {
          title: '평균 ROAS',
          value: kpiData.avgRoas !== null ? `${kpiData.avgRoas.toFixed(2)}%` : '-',
          icon: TrendingUp,
          color: 'text-green-600',
          isPositive: true,
          diff:
            kpiData.avgRoas !== null && prevKpiData?.avgRoas != null
              ? calcDiff(kpiData.avgRoas, prevKpiData.avgRoas)
              : null,
          prevValue: prevKpiData?.avgRoas != null ? `${prevKpiData.avgRoas.toFixed(2)}%` : null,
        },
        {
          title: '평균 CTR',
          value: kpiData.avgCtr !== null ? `${kpiData.avgCtr.toFixed(2)}%` : '-',
          icon: MousePointerClick,
          color: 'text-blue-600',
          isPositive: true,
          diff:
            kpiData.avgCtr !== null && prevKpiData?.avgCtr != null
              ? calcDiff(kpiData.avgCtr, prevKpiData.avgCtr)
              : null,
          prevValue: prevKpiData?.avgCtr != null ? `${prevKpiData.avgCtr.toFixed(2)}%` : null,
        },
        {
          title: '평균 CVR',
          value: kpiData.avgCvr !== null ? `${kpiData.avgCvr.toFixed(2)}%` : '-',
          icon: Target,
          color: 'text-purple-600',
          isPositive: true,
          diff:
            kpiData.avgCvr !== null && prevKpiData?.avgCvr != null
              ? calcDiff(kpiData.avgCvr, prevKpiData.avgCvr)
              : null,
          prevValue: prevKpiData?.avgCvr != null ? `${prevKpiData.avgCvr.toFixed(2)}%` : null,
        },
      ]

  // 빈 문자열 adType은 SelectItem value로 허용되지 않으므로 필터링
  const adTypeOptions = [
    { value: 'all', label: '전체' },
    ...adTypes.filter((t) => t.trim() !== '').map((t) => ({ value: t, label: t })),
  ]

  function handleTabChange(nextTab: string) {
    if (
      nextTab !== 'dashboard' &&
      nextTab !== 'keywords' &&
      nextTab !== 'products' &&
      nextTab !== 'addata' &&
      nextTab !== 'trends'
    )
      return

    const params = new URLSearchParams(searchParams.toString())
    if (nextTab === 'dashboard') params.delete('tab')
    else params.set('tab', nextTab)

    const query = params.toString()
    setMemoTarget(null)
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  return (
    <div className="space-y-6">
      {/* 페이지 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className={isEditingName ? 'w-1/2' : ''}>
          {isEditingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName()
                  if (e.key === 'Escape') setIsEditingName(false)
                }}
                className="h-9 min-w-48 flex-1 text-xl font-bold"
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
      <Card className="py-3">
        <CardContent>
          <FilterBar adTypeOptions={adTypeOptions} showAdTypeFilter={adTypes.length > 1} />
        </CardContent>
      </Card>

      {/* 예산/목표 ROAS 현황 (필터 아래) */}
      <CampaignTargetSection campaignId={campaignId} from={from} to={to} />

      {/* 탭 영역 */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-5">
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
            value="products"
            className="border border-transparent hover:border-border hover:bg-background/70"
          >
            상품 분석
          </TabsTrigger>
          <TabsTrigger
            value="trends"
            className="border border-transparent hover:border-border hover:bg-background/70"
          >
            매출 트렌드
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
              const { diff, isPositive, prevValue } = card
              // 색상 결정: isPositive면 상승=녹, 하락=적 / isPositive=false면 반대
              const diffColor =
                diff === null || diff === 0
                  ? 'text-muted-foreground'
                  : diff > 0 === isPositive
                    ? 'text-green-600'
                    : 'text-red-500'
              return (
                <Card key={card.title}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                    <Icon className={`h-4 w-4 ${card.color}`} />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{card.value}</div>
                    {diff !== null && (
                      <div className={`mt-1 flex items-center gap-0.5 text-xs ${diffColor}`}>
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
                    )}
                    {prevValue !== null && (
                      <p className="mt-0.5 text-xs text-muted-foreground">이전: {prevValue}</p>
                    )}
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
                targetDate={memoTarget?.date ?? null}
                targetDateVersion={memoTarget?.version ?? 0}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── 키워드 분석 탭 ── */}
        <TabsContent value="keywords" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="키워드 검색"
                value={kwSearch}
                onChange={(e) => {
                  setKwSearch(e.target.value)
                  setSelectedKeywords([])
                }}
                className="h-8 w-40 text-sm"
              />
              <Button
                variant={kwFilter === 'zero' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const next = kwFilter === 'zero' ? 'all' : 'zero'
                  setKwFilter(next)
                  setSelectedKeywords([])
                  if (next === 'zero') {
                    setKwSortBy('adCost')
                    setKwSortOrder('desc')
                  }
                }}
              >
                📉저효율 키워드
              </Button>
              <Button
                variant={kwFilter === 'orders' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const next = kwFilter === 'orders' ? 'all' : 'orders'
                  setKwFilter(next)
                  setSelectedKeywords([])
                  if (next === 'orders') {
                    setKwSortBy('orders1d')
                    setKwSortOrder('desc')
                  }
                }}
              >
                📈주문 발생 키워드
              </Button>
              <div className="flex items-center gap-1.5">
                <Checkbox
                  id="kw-exclude-removed"
                  checked={kwExcludeRemoved}
                  onCheckedChange={() => {
                    setKwExcludeRemoved((prev) => !prev)
                    setSelectedKeywords([])
                  }}
                />
                <label htmlFor="kw-exclude-removed" className="cursor-pointer text-sm select-none">
                  제거 제외
                </label>
              </div>
              <span className="text-sm text-muted-foreground">전체 {keywords.length}개 키워드</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {selectedKeywords.some((kw) => keywords.find((k) => k.keyword === kw)?.removedAt) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-muted-foreground"
                  onClick={handleCancelRemoval}
                >
                  제거 취소
                </Button>
              )}
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
                    <TableHead className="text-muted-foreground">제거 상태</TableHead>
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
                      onClick={() => handleKwSort('adCost')}
                    >
                      <span className="flex items-center justify-end">
                        광고비(비중)
                        <KwSortIcon column="adCost" sortKey={kwSortBy} sortOrder={kwSortOrder} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-right select-none"
                      onClick={() => handleKwSort('orders1d')}
                    >
                      <span className="flex items-center justify-end">
                        주문 수
                        <KwSortIcon column="orders1d" sortKey={kwSortBy} sortOrder={kwSortOrder} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-right select-none"
                      onClick={() => handleKwSort('revenue1d')}
                    >
                      <span className="flex items-center justify-end">
                        매출액
                        <KwSortIcon column="revenue1d" sortKey={kwSortBy} sortOrder={kwSortOrder} />
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
                        colSpan={9}
                        className="py-12 text-center text-sm text-muted-foreground"
                      >
                        {kwFilter === 'all'
                          ? '키워드 데이터가 없습니다'
                          : '필터 조건에 맞는 키워드가 없습니다'}
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
                        <TableCell className="text-sm" onClick={(e) => e.stopPropagation()}>
                          {kw.removedAt ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                [제거] {kw.removedAt}
                              </span>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5 text-muted-foreground hover:text-red-600"
                                title="제거 취소"
                                onClick={() => handleSingleCancelRemoval(kw.keyword)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-xs"
                              onClick={() => handleSingleKeywordRemove(kw.keyword)}
                            >
                              제거
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">{fmt(kw.ctr, '%')}</TableCell>
                        <TableCell className="text-right text-sm">{fmt(kw.cvr, '%')}</TableCell>
                        <TableCell className="text-right text-sm font-medium text-orange-600">
                          {kw.adCost.toLocaleString()}원
                          {kpiData.totalAdCost > 0 && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              ({((kw.adCost / kpiData.totalAdCost) * 100).toFixed(2)}%)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {kw.orders1d.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {kw.revenue1d.toLocaleString()}원
                        </TableCell>
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

        {/* ── 상품 분석 탭 ── */}
        <TabsContent value="products" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="상품명 검색"
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                className="h-8 w-40 text-sm"
              />
              <Button
                variant={productFilterMode === 'zero' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const next = productFilterMode === 'zero' ? 'all' : 'zero'
                  setProductFilterMode(next)
                  if (next === 'zero') {
                    setProductSortBy('adCost')
                    setProductSortOrder('desc')
                  }
                  setSelectedProducts([])
                }}
              >
                📉저효율 상품
              </Button>
              <Button
                variant={productFilterMode === 'orders' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const next = productFilterMode === 'orders' ? 'all' : 'orders'
                  setProductFilterMode(next)
                  if (next === 'orders') {
                    setProductSortBy('revenue1d')
                    setProductSortOrder('desc')
                  }
                  setSelectedProducts([])
                }}
              >
                📈주문 발생 상품
              </Button>
              <div className="flex items-center gap-1.5">
                <Checkbox
                  id="product-exclude-removed"
                  checked={productExcludeRemoved}
                  onCheckedChange={() => {
                    setProductExcludeRemoved((prev) => !prev)
                    setSelectedProducts([])
                  }}
                />
                <label
                  htmlFor="product-exclude-removed"
                  className="cursor-pointer text-sm select-none"
                >
                  제거 제외
                </label>
              </div>
              <span className="text-sm text-muted-foreground">
                전체 {productItems.length}개 상품 옵션
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {selectedProducts.some((selectedKey) => {
                const selectedItem = productItems.find(
                  (p) => `${p.productName}|${p.optionId ?? ''}` === selectedKey
                )
                return !!selectedItem?.removedAt
              }) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-muted-foreground"
                  onClick={handleSelectedProductCancelRemoval}
                >
                  제거 취소
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={selectedProducts.length === 0}
                onClick={() => {
                  const items = productItems.filter((p) =>
                    selectedProducts.includes(`${p.productName}|${p.optionId ?? ''}`)
                  )
                  openProductRemoveDialog(items)
                }}
              >
                상품 제거 ({selectedProducts.length})
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={
                            selectedProducts.length > 0 &&
                            selectedProducts.length === filteredSortedProducts.length
                          }
                          onCheckedChange={(checked) => {
                            const visible = filteredSortedProducts.map(
                              (p) => `${p.productName}|${p.optionId ?? ''}`
                            )
                            setSelectedProducts(checked ? visible : [])
                          }}
                          aria-label="전체 선택"
                        />
                      </TableHead>
                      <TableHead className="min-w-48">상품명</TableHead>
                      <TableHead className="min-w-24">옵션명</TableHead>
                      <TableHead className="min-w-24">옵션ID</TableHead>
                      <TableHead className="text-muted-foreground">제거 상태</TableHead>
                      <TableHead
                        className="cursor-pointer text-right select-none"
                        onClick={() => handleProductSort('ctr')}
                      >
                        <span className="flex items-center justify-end">
                          CTR
                          <ProdSortIcon
                            column="ctr"
                            sortKey={productSortBy}
                            sortOrder={productSortOrder}
                          />
                        </span>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer text-right select-none"
                        onClick={() => handleProductSort('cvr')}
                      >
                        <span className="flex items-center justify-end">
                          CVR
                          <ProdSortIcon
                            column="cvr"
                            sortKey={productSortBy}
                            sortOrder={productSortOrder}
                          />
                        </span>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer text-right select-none"
                        onClick={() => handleProductSort('adCost')}
                      >
                        <span className="flex items-center justify-end">
                          광고비(비중)
                          <ProdSortIcon
                            column="adCost"
                            sortKey={productSortBy}
                            sortOrder={productSortOrder}
                          />
                        </span>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer text-right select-none"
                        onClick={() => handleProductSort('orders1d')}
                      >
                        <span className="flex items-center justify-end">
                          주문수
                          <ProdSortIcon
                            column="orders1d"
                            sortKey={productSortBy}
                            sortOrder={productSortOrder}
                          />
                        </span>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer text-right select-none"
                        onClick={() => handleProductSort('revenue1d')}
                      >
                        <span className="flex items-center justify-end">
                          매출액
                          <ProdSortIcon
                            column="revenue1d"
                            sortKey={productSortBy}
                            sortOrder={productSortOrder}
                          />
                        </span>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer text-right select-none"
                        onClick={() => handleProductSort('roas')}
                      >
                        <span className="flex items-center justify-end">
                          ROAS
                          <ProdSortIcon
                            column="roas"
                            sortKey={productSortBy}
                            sortOrder={productSortOrder}
                          />
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productLoading ? (
                      <TableRow>
                        <TableCell
                          colSpan={11}
                          className="py-12 text-center text-sm text-muted-foreground"
                        >
                          불러오는 중...
                        </TableCell>
                      </TableRow>
                    ) : filteredSortedProducts.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={11}
                          className="py-12 text-center text-sm text-muted-foreground"
                        >
                          상품 데이터가 없습니다
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredSortedProducts.map((p) => {
                        const key = `${p.productName}|${p.optionId ?? ''}`
                        const isSelected = selectedProducts.includes(key)
                        return (
                          <TableRow
                            key={key}
                            className="cursor-pointer"
                            onClick={() =>
                              setSelectedProducts((prev) =>
                                prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
                              )
                            }
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() =>
                                  setSelectedProducts((prev) =>
                                    prev.includes(key)
                                      ? prev.filter((k) => k !== key)
                                      : [...prev, key]
                                  )
                                }
                                aria-label={p.parsedProductName}
                              />
                            </TableCell>
                            <TableCell className="max-w-48 text-sm font-medium">
                              <div className="truncate" title={p.parsedProductName}>
                                {p.parsedProductName || p.productName}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {p.optionName ?? '-'}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {p.optionId ?? '-'}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {p.removedAt ? (
                                <span className="inline-flex items-center gap-1">
                                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                    [제거] {p.removedAt}
                                  </span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-5 w-5 text-muted-foreground hover:text-red-600"
                                    title="제거 취소"
                                    onClick={() => handleProductCancelRemoval(p)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-xs"
                                  onClick={() => openProductRemoveDialog([p])}
                                >
                                  제거
                                </Button>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm">{fmt(p.ctr, '%')}</TableCell>
                            <TableCell className="text-right text-sm">{fmt(p.cvr, '%')}</TableCell>
                            <TableCell className="text-right text-sm font-medium text-orange-600">
                              {p.adCost.toLocaleString('ko-KR')}원
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                ({p.adCostShare.toFixed(2)}%)
                              </span>
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {p.orders1d.toLocaleString('ko-KR')}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {p.revenue1d.toLocaleString('ko-KR')}원
                            </TableCell>
                            <TableCell className="text-right text-sm">{fmt(p.roas, '%')}</TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {selectedProducts.length > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              {selectedProducts.length}개 상품 옵션 선택됨 · 상품 제거 버튼을 클릭하면 제거 기록을
              남길 수 있습니다
            </p>
          )}
        </TabsContent>

        {/* ── 매출 트렌드 탭 ── */}
        <TabsContent value="trends" className="space-y-4">
          <ProductTrendsTable campaignId={campaignId} from={from} to={to} />
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

      {/* 제거 취소 확인 다이얼로그 */}
      <Dialog
        open={isRemovalCancelConfirmOpen}
        onOpenChange={(open) => {
          if (isCancellingRemoval) return
          setIsRemovalCancelConfirmOpen(open)
          if (!open) setRemovalCancelContext(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>제거 상태를 취소하시겠어요?</DialogTitle>
            <DialogDescription>
              {removalCancelContext
                ? `${removalCancelContext.type === 'keyword' ? '키워드' : '상품'} ${
                    removalCancelContext.type === 'keyword'
                      ? removalCancelContext.keywords.length
                      : removalCancelContext.items.length
                  }개 항목의 제거 상태를 취소합니다.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Checkbox
              id="write-cancel-memo"
              checked={isWritingCancelMemo}
              onCheckedChange={(checked) => setIsWritingCancelMemo(checked === true)}
            />
            <label htmlFor="write-cancel-memo" className="cursor-pointer text-sm select-none">
              제거 취소 메모 남기기
            </label>
          </div>
          <DialogFooter className="gap-3 sm:gap-3">
            <Button
              variant="outline"
              disabled={isCancellingRemoval}
              onClick={() => {
                setIsRemovalCancelConfirmOpen(false)
                setRemovalCancelContext(null)
              }}
            >
              취소
            </Button>
            <Button onClick={handleConfirmRemovalCancel} disabled={isCancellingRemoval}>
              {isCancellingRemoval ? '처리 중...' : '확인'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 제거 취소 메모 다이얼로그 */}
      <Dialog
        open={isCancelMemoDialogOpen}
        onOpenChange={(open) => {
          if (isSavingCancelMemo) return
          setIsCancelMemoDialogOpen(open)
          if (!open) setRemovalCancelContext(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>제거 취소 메모</DialogTitle>
            <DialogDescription>제거 취소 내역을 메모로 남깁니다.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-memo-date">작성 일자</Label>
            <Input
              id="cancel-memo-date"
              type="date"
              value={cancelMemoDate}
              max={getTodayKst()}
              onChange={(e) => setCancelMemoDate(e.target.value)}
            />
            <Label htmlFor="cancel-memo-content">내용</Label>
            <Textarea
              id="cancel-memo-content"
              value={cancelMemoContent}
              onChange={(e) => setCancelMemoContent(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter className="gap-3 sm:gap-3">
            <Button variant="outline" onClick={() => setIsCancelMemoDialogOpen(false)}>
              닫기
            </Button>
            <Button
              onClick={handleSaveCancelMemo}
              disabled={isSavingCancelMemo || !cancelMemoContent.trim()}
            >
              {isSavingCancelMemo ? '저장 중...' : '메모 남기기'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 키워드 복사 완료 다이얼로그 */}
      <Dialog open={isCopyDoneOpen} onOpenChange={setIsCopyDoneOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>키워드 복사 완료</DialogTitle>
            <DialogDescription>
              {copiedKeywords.length}개 키워드가 클립보드에 복사되었습니다.
            </DialogDescription>
          </DialogHeader>
          {/* 메모 작성 UI */}
          <p className="text-sm font-medium">제거 키워드를 기록으로 남길까요?</p>
          <div className="space-y-2">
            <Label htmlFor="memo-date">작성 일자</Label>
            <Input
              id="memo-date"
              type="date"
              value={memoDate}
              max={getTodayKst()}
              onChange={(e) => setMemoDate(e.target.value)}
            />
            <Label htmlFor="memo-content">내용</Label>
            <Textarea
              id="memo-content"
              value={memoContent}
              onChange={(e) => setMemoContent(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter className="gap-3 sm:gap-3">
            <Button variant="outline" onClick={() => setIsCopyDoneOpen(false)}>
              닫기
            </Button>
            <Button onClick={handleSaveKeywordMemo} disabled={isSavingMemo || !memoContent.trim()}>
              {isSavingMemo ? '저장 중...' : '메모 남기기'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 상품 제거 다이얼로그 */}
      <Dialog open={isProductRemoveDialogOpen} onOpenChange={setIsProductRemoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>상품 제거</DialogTitle>
            <DialogDescription>
              상품 옵션을 제거 기록으로 남길까요? ({productRemovingItems.length}개)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="product-memo-date">작성 일자</Label>
            <Input
              id="product-memo-date"
              type="date"
              value={productMemoDate}
              max={getTodayKst()}
              onChange={(e) => setProductMemoDate(e.target.value)}
            />
            <Label htmlFor="product-memo-content">내용</Label>
            <Textarea
              id="product-memo-content"
              value={productMemoContent}
              onChange={(e) => setProductMemoContent(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter className="gap-3 sm:gap-3">
            <Button variant="outline" onClick={() => setIsProductRemoveDialogOpen(false)}>
              닫기
            </Button>
            <Button
              onClick={handleSaveProductMemo}
              disabled={isSavingProductMemo || !productMemoContent.trim()}
            >
              {isSavingProductMemo ? '저장 중...' : '메모 남기기'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
