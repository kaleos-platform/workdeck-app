'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link2, Lock, Plus, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  FloatingActionBar,
  floatingActionButtonClass,
  floatingActionButtonDestructiveClass,
  floatingActionSelectTriggerClass,
} from '@/components/ui/floating-action-bar'
import { applyRangeSelection } from '@/lib/range-selection'
import {
  KEYWORD_LINK_ROLE_LABELS,
  KEYWORD_SOURCE_LABELS,
  KEYWORD_STATUS_LABELS,
  KEYWORD_TYPE_LABELS,
} from '@/lib/sh/keyword-labels'
import type {
  KeywordLinkRole,
  KeywordMasterSource,
  KeywordMasterType,
} from '@/generated/prisma/enums'
import {
  OptionPickerDialog,
  type PickedOption,
} from '@/components/sh/products/listings/option-picker-dialog'
import { KeywordCreateDialog } from './keyword-create-dialog'
import { KeywordDuplicatePanel, type DuplicateCluster } from './keyword-duplicate-panel'
import { KeywordStatusBadge, type KeywordStatus } from './keyword-status'

const PAGE_SIZE = 50
const ALL = 'all'

/** GET /api/sh/keywords 의 data[] 한 행 (serializeKeyword 결과). */
type KeywordRow = {
  id: string
  keyword: string
  category: string | null
  type: KeywordMasterType
  source: KeywordMasterSource
  status: KeywordStatus
  score: number
  researchedAt: string | null
  memo: string | null
  links: Array<{
    id: string
    productId: string | null
    listingId: string | null
    role: KeywordLinkRole
    sortOrder: number
    /** 연결 대상이 삭제된 잔여 링크면 null 로 온다. */
    product: { id: string; name: string; internalName: string | null } | null
    listing: {
      id: string
      searchName: string
      managementName: string | null
      channelId: string
      channel: { id: string; name: string; externalSource: string | null } | null
    } | null
  }>
}

const STATUS_KEYS = Object.keys(KEYWORD_STATUS_LABELS) as KeywordStatus[]
const TYPE_KEYS = Object.keys(KEYWORD_TYPE_LABELS) as KeywordMasterType[]
const SOURCE_KEYS = Object.keys(KEYWORD_SOURCE_LABELS) as KeywordMasterSource[]
const ROLE_KEYS = Object.keys(KEYWORD_LINK_ROLE_LABELS) as KeywordLinkRole[]

function formatDate(value: string | null) {
  if (!value) return '-'
  return value.slice(0, 10)
}

export function KeywordMasterView() {
  const [rows, setRows] = useState<KeywordRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  // ─── 필터 ─────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>(ALL)
  const [typeFilter, setTypeFilter] = useState<string>(ALL)
  const [sourceFilter, setSourceFilter] = useState<string>(ALL)
  const [productFilter, setProductFilter] = useState<{ id: string; name: string } | null>(null)
  // 점수 범위·중복 의심 토글은 서버 필터가 없어 **불러온 페이지 안에서만** 걸린다.
  // 라벨에 그 사실을 적어두지 않으면 일괄 액션 건수가 전체 매칭 건수처럼 읽힌다.
  const [scoreMin, setScoreMin] = useState('')
  const [scoreMax, setScoreMax] = useState('')
  const [dupOnly, setDupOnly] = useState(false)

  // ─── 중복 클러스터 ────────────────────────────────────────────────────────
  const [clusters, setClusters] = useState<DuplicateCluster[]>([])
  const [clustersLoading, setClustersLoading] = useState(true)

  // ─── 다중 선택 ────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastClickedIndexRef = useRef<number | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkRole, setBulkRole] = useState<KeywordLinkRole>('MAIN')
  // 상태 변경 Select 를 처리 후 placeholder 로 되돌리기 위한 remount key
  const [statusSelectKey, setStatusSelectKey] = useState(0)

  const [filterPickerOpen, setFilterPickerOpen] = useState(false)
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const fetchKeywords = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim())
      if (statusFilter !== ALL) params.set('status', statusFilter)
      if (typeFilter !== ALL) params.set('type', typeFilter)
      if (sourceFilter !== ALL) params.set('source', sourceFilter)
      if (productFilter) params.set('productId', productFilter.id)

      const res = await fetch(`/api/sh/keywords?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? '키워드를 불러오지 못했습니다')
      }
      const data = await res.json()
      setRows(data.data ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      setRows([])
      setTotal(0)
      toast.error(err instanceof Error ? err.message : '키워드를 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch, statusFilter, typeFilter, sourceFilter, productFilter])

  const fetchDuplicates = useCallback(async () => {
    setClustersLoading(true)
    try {
      const res = await fetch('/api/sh/keywords/duplicates')
      if (!res.ok) throw new Error('중복 탐지에 실패했습니다')
      const data = await res.json()
      setClusters(data.clusters ?? [])
    } catch {
      setClusters([])
    } finally {
      setClustersLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKeywords()
  }, [fetchKeywords])

  useEffect(() => {
    fetchDuplicates()
  }, [fetchDuplicates])

  // 필터/페이지가 바뀌면 선택은 무효 — 화면 밖 행에 일괄 액션이 나가지 않게 한다.
  useEffect(() => {
    setSelected(new Set())
    lastClickedIndexRef.current = null
  }, [page, debouncedSearch, statusFilter, typeFilter, sourceFilter, productFilter])

  /** 중복 클러스터에 속한 모든 키워드 id (space 전체 기준) */
  const duplicateIds = useMemo(
    () => new Set(clusters.flatMap((c) => c.members.map((m) => m.id))),
    [clusters]
  )

  const visibleRows = useMemo(() => {
    const min = scoreMin.trim() === '' ? null : Number(scoreMin)
    const max = scoreMax.trim() === '' ? null : Number(scoreMax)
    return rows.filter((r) => {
      if (min !== null && !Number.isNaN(min) && r.score < min) return false
      if (max !== null && !Number.isNaN(max) && r.score > max) return false
      if (dupOnly && !duplicateIds.has(r.id)) return false
      return true
    })
  }, [rows, scoreMin, scoreMax, dupOnly, duplicateIds])

  // applyRangeSelection 의 index 는 **selectableIds 안에서의 위치**여야 한다.
  // 화면에 보이는 행만 선택 대상이므로 visibleRows 를 그대로 쓴다.
  const selectableIds = useMemo(() => visibleRows.map((r) => r.id), [visibleRows])

  // 일괄 액션의 실제 대상 = **화면에 보이는 선택 행**만.
  // 점수/중복 조건은 클라이언트에서 걸리므로, 선택 후 조건을 좁히면 selected 에는
  // 화면에서 사라진 id 가 남는다. 그대로 보내면 안 보이는 행까지 삭제된다.
  const targetIds = useMemo(
    () => selectableIds.filter((id) => selected.has(id)),
    [selectableIds, selected]
  )
  const allSelected = selectableIds.length > 0 && targetIds.length === selectableIds.length
  const someSelected = !allSelected && targetIds.length > 0

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(selectableIds) : new Set())
    lastClickedIndexRef.current = null
  }

  function toggleRow(id: string, index: number, shiftKey: boolean) {
    setSelected((prev) =>
      applyRangeSelection(prev, selectableIds, id, index, shiftKey, lastClickedIndexRef.current)
    )
    lastClickedIndexRef.current = index
  }

  /** 중복 패널에서 넘어온 id 중 현재 목록에 있는 것만 선택한다. */
  function selectClusterMembers(ids: string[]) {
    const present = ids.filter((id) => selectableIds.includes(id))
    if (present.length === 0) {
      toast.info('해당 키워드가 현재 목록 페이지에 없습니다. 필터를 조정해 주세요')
      return
    }
    setSelected(new Set(present))
    lastClickedIndexRef.current = null
    if (present.length < ids.length) {
      toast.info(`${ids.length}개 중 이 페이지의 ${present.length}개만 선택했습니다`)
    }
  }

  // ─── 일괄 액션 ────────────────────────────────────────────────────────────
  async function runBulk(body: Record<string, unknown>, successMessage: (n: number) => string) {
    setBulkBusy(true)
    try {
      const res = await fetch('/api/sh/keywords/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? '일괄 처리에 실패했습니다')
      const count = data.updated ?? data.deleted ?? data.linked ?? 0
      toast.success(successMessage(count))
      setSelected(new Set())
      lastClickedIndexRef.current = null
      await Promise.all([fetchKeywords(), fetchDuplicates()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '일괄 처리에 실패했습니다')
    } finally {
      setBulkBusy(false)
      setStatusSelectKey((k) => k + 1)
    }
  }

  function handleBulkStatus(status: string) {
    if (targetIds.length === 0) return
    void runBulk(
      { ids: targetIds, action: 'status', payload: { status } },
      (n) =>
        `${n}개 키워드 상태를 '${KEYWORD_STATUS_LABELS[status as KeywordStatus]}'로 변경했습니다`
    )
  }

  function handleBulkDelete() {
    if (targetIds.length === 0) return
    if (!window.confirm(`선택한 ${targetIds.length}개 키워드를 삭제합니다. 진행할까요?`)) return
    void runBulk({ ids: targetIds, action: 'delete' }, (n) => `${n}개 키워드를 삭제했습니다`)
  }

  function handleBulkLink(productId: string) {
    if (targetIds.length === 0) return
    void runBulk(
      {
        ids: targetIds,
        action: 'link',
        payload: { productId, role: bulkRole },
      },
      (n) => `${n}개 키워드를 상품에 연결했습니다`
    )
  }

  /** 연결 해제 — 연동 채널 미러 대상에는 이 버튼을 아예 노출하지 않는다. */
  async function handleUnlink(linkId: string) {
    try {
      const res = await fetch('/api/sh/keywords/links', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: linkId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? '연결 해제에 실패했습니다')
      toast.success('연결을 해제했습니다')
      await fetchKeywords()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '연결 해제에 실패했습니다')
    }
  }

  /**
   * 연결 칩 표시 정보. 이름·채널·미러 여부는 모두 목록 응답의 links[] 에 실려 오므로
   * 별도 참조 조회 없이 확정적으로 판정한다.
   * - 상품 표시명: internalName ?? name (관리 상품명 우선)
   * - 판매채널 상품 표시명: managementName ?? searchName (스키마 fallback 규칙)
   * - 연동 채널(externalSource != null)의 판매채널 상품은 대표 채널의 읽기전용 미러라
   *   편집 어포던스를 숨긴다 (src/lib/sh/channel-relation.ts 와 동일 기준).
   * 관계가 null 인 건 연결 대상이 삭제된 잔여 링크뿐이라 잠글 이유가 없다.
   */
  function linkChipInfo(link: KeywordRow['links'][number]) {
    if (link.listingId != null) {
      const listing = link.listing
      return {
        name: listing ? (listing.managementName ?? listing.searchName) : '판매채널 상품',
        channelName: listing?.channel?.name ?? null,
        locked: listing?.channel?.externalSource != null,
      }
    }
    const product = link.product
    return {
      name: product ? (product.internalName ?? product.name) : '상품',
      channelName: null as string | null,
      locked: false,
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasClientFilter = dupOnly || scoreMin.trim() !== '' || scoreMax.trim() !== ''

  function resetFilters() {
    setSearch('')
    setStatusFilter(ALL)
    setTypeFilter(ALL)
    setSourceFilter(ALL)
    setProductFilter(null)
    setScoreMin('')
    setScoreMax('')
    setDupOnly(false)
    setPage(1)
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {/* 키워드가 들어오는 경로는 두 개다 — 여기(직접 조사한 후보 붙여넣기)와
            판매채널 상품 편집 화면의 "키워드 마스터에 등록"(이미 쓰는 검색어 승격). */}
        <div className="flex justify-end">
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            키워드 추가
          </Button>
        </div>

        {/* ─── 필터 바 ───────────────────────────────────────────────────── */}
        <section aria-label="키워드 필터" className="rounded-lg border p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1 lg:col-span-2">
              <Label htmlFor="keyword-search">검색어</Label>
              <div className="relative">
                <Search
                  className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="keyword-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="키워드로 검색"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="keyword-status">상태</Label>
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v)
                  setPage(1)
                }}
              >
                <SelectTrigger id="keyword-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>전체</SelectItem>
                  {STATUS_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {KEYWORD_STATUS_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="keyword-type">유형</Label>
              <Select
                value={typeFilter}
                onValueChange={(v) => {
                  setTypeFilter(v)
                  setPage(1)
                }}
              >
                <SelectTrigger id="keyword-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>전체</SelectItem>
                  {TYPE_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {KEYWORD_TYPE_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="keyword-source">출처</Label>
              <Select
                value={sourceFilter}
                onValueChange={(v) => {
                  setSourceFilter(v)
                  setPage(1)
                }}
              >
                <SelectTrigger id="keyword-source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>전체</SelectItem>
                  {SOURCE_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {KEYWORD_SOURCE_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="keyword-product-filter">연결 상품</Label>
              <div className="flex items-center gap-1">
                <Button
                  id="keyword-product-filter"
                  type="button"
                  variant="outline"
                  className="w-full justify-start truncate font-normal"
                  onClick={() => setFilterPickerOpen(true)}
                >
                  {productFilter ? productFilter.name : '전체 상품'}
                </Button>
                {productFilter && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="연결 상품 필터 해제"
                    onClick={() => {
                      setProductFilter(null)
                      setPage(1)
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="keyword-score-min">점수 범위</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="keyword-score-min"
                  type="number"
                  inputMode="numeric"
                  value={scoreMin}
                  onChange={(e) => setScoreMin(e.target.value)}
                  placeholder="최소"
                  aria-label="최소 점수"
                />
                <span className="text-muted-foreground" aria-hidden>
                  ~
                </span>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={scoreMax}
                  onChange={(e) => setScoreMax(e.target.value)}
                  placeholder="최대"
                  aria-label="최대 점수"
                />
              </div>
            </div>

            <div className="flex items-end gap-3">
              <label
                htmlFor="keyword-dup-only"
                className="flex cursor-pointer items-center gap-2 py-2 text-sm"
              >
                <Checkbox
                  id="keyword-dup-only"
                  checked={dupOnly}
                  onCheckedChange={(v) => setDupOnly(!!v)}
                />
                중복 의심만
              </label>
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                초기화
              </Button>
            </div>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            전체 {total.toLocaleString()}건 중 이 페이지 {rows.length}건 표시
            {hasClientFilter && ` · 점수·중복 조건 적용 후 ${visibleRows.length}건`}
            {hasClientFilter && (
              <span className="ml-1 text-amber-700">
                (점수 범위·중복 의심 조건은 불러온 페이지 안에서만 적용됩니다)
              </span>
            )}
          </p>
        </section>

        {/* ─── 중복 탐지 패널 ─────────────────────────────────────────────── */}
        <KeywordDuplicatePanel
          clusters={clusters}
          loading={clustersLoading}
          onSelectCluster={selectClusterMembers}
        />

        {/* ─── 목록 ───────────────────────────────────────────────────────── */}
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={(v) => toggleAll(!!v)}
                    disabled={selectableIds.length === 0}
                    aria-label="이 페이지 전체 선택"
                  />
                </TableHead>
                <TableHead>키워드</TableHead>
                <TableHead>카테고리</TableHead>
                <TableHead>유형</TableHead>
                <TableHead>출처</TableHead>
                <TableHead className="text-right">점수</TableHead>
                <TableHead>연결 상품</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>조사일</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    불러오는 중...
                  </TableCell>
                </TableRow>
              ) : visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    조건에 맞는 키워드가 없습니다
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map((row, index) => {
                  const checked = selected.has(row.id)
                  return (
                    <TableRow key={row.id} data-state={checked ? 'selected' : undefined}>
                      {/* Shift+클릭 범위 선택 — shiftKey 는 onCheckedChange 로 알 수 없어
                          셀 클릭에서 처리한다(다른 목록과 동일 패턴). */}
                      <TableCell
                        className="w-10 cursor-pointer"
                        onClick={(e) => toggleRow(row.id, index, e.shiftKey)}
                      >
                        <Checkbox
                          checked={checked}
                          tabIndex={-1}
                          className="pointer-events-none"
                          aria-label={`${row.keyword} 선택`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.keyword}
                        {row.memo && (
                          <p className="text-xs font-normal text-muted-foreground">{row.memo}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.category ?? '-'}
                      </TableCell>
                      <TableCell className="text-sm">{KEYWORD_TYPE_LABELS[row.type]}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {KEYWORD_SOURCE_LABELS[row.source]}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.score}</TableCell>
                      <TableCell>
                        {row.links.length === 0 ? (
                          <span className="text-sm text-muted-foreground">-</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {row.links.map((link) => {
                              const info = linkChipInfo(link)
                              return (
                                <span
                                  key={link.id}
                                  className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs"
                                >
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="max-w-[10rem] truncate">{info.name}</span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-[260px] text-xs">
                                      {info.channelName
                                        ? `${info.channelName} · ${info.name}`
                                        : info.name}
                                    </TooltipContent>
                                  </Tooltip>
                                  <Badge variant="outline" className="text-[10px]">
                                    {KEYWORD_LINK_ROLE_LABELS[link.role]}
                                  </Badge>
                                  {info.locked ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Lock
                                          className="h-3 w-3 text-muted-foreground"
                                          aria-label="연동 채널 미러 — 편집 불가"
                                        />
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-[220px] text-xs">
                                        연동 채널의 판매채널 상품은 대표 채널을 미러링한 읽기전용
                                        대상입니다. 연결은 대표 채널에서 관리하세요
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleUnlink(link.id)}
                                      className="text-muted-foreground hover:text-destructive"
                                      aria-label={`${info.name} 연결 해제`}
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                </span>
                              )
                            })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <KeywordStatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">
                        {formatDate(row.researchedAt)}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-end gap-2">
            <span className="text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              이전
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </Button>
          </div>
        )}

        {/* ─── 일괄 액션 (규칙 §3.1 — 페이지 흐름 안에 액션 영역을 두지 않는다) ─── */}
        <FloatingActionBar
          open={targetIds.length > 0}
          onClear={() => {
            setSelected(new Set())
            lastClickedIndexRef.current = null
          }}
          clearDisabled={bulkBusy}
          actions={
            <>
              {/* 비제어 Select + key 리셋 — value=""(빈 문자열) 로 고정하면 Radix 가
                  "변경 없음"으로 보고 같은 값을 다시 고를 때 onValueChange 가 죽는다. */}
              <Select
                key={statusSelectKey}
                disabled={bulkBusy}
                onValueChange={(v) => {
                  if (v) handleBulkStatus(v)
                }}
              >
                <SelectTrigger
                  className={`w-[140px] ${floatingActionSelectTriggerClass}`}
                  aria-label="선택한 키워드의 상태 변경"
                >
                  <SelectValue placeholder="상태 변경" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {KEYWORD_STATUS_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={bulkRole}
                disabled={bulkBusy}
                onValueChange={(v) => setBulkRole(v as KeywordLinkRole)}
              >
                <SelectTrigger
                  className={`w-[110px] ${floatingActionSelectTriggerClass}`}
                  aria-label="연결 역할"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {KEYWORD_LINK_ROLE_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={floatingActionButtonClass}
                disabled={bulkBusy}
                onClick={() => setLinkPickerOpen(true)}
              >
                <Link2 className="mr-1 h-4 w-4" />
                상품 연결
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={floatingActionButtonDestructiveClass}
                disabled={bulkBusy}
                onClick={handleBulkDelete}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                삭제
              </Button>
            </>
          }
        >
          <span className="text-sm font-semibold">{targetIds.length}개</span>
          <span className="text-xs text-background/70">선택됨</span>
        </FloatingActionBar>

        {/* 필터용 상품 선택 */}
        <OptionPickerDialog
          open={filterPickerOpen}
          onOpenChange={setFilterPickerOpen}
          mode="product-with-all-options"
          onPickProduct={(productId, opts: PickedOption[]) => {
            setProductFilter({ id: productId, name: opts[0]?.productName ?? '선택한 상품' })
            setPage(1)
          }}
        />

        {/* 일괄 연결용 상품 선택 */}
        <OptionPickerDialog
          open={linkPickerOpen}
          onOpenChange={setLinkPickerOpen}
          mode="product-with-all-options"
          onPickProduct={(productId) => handleBulkLink(productId)}
        />

        {/* 키워드 일괄 추가 — 목록과 중복 패널을 함께 갱신한다 */}
        <KeywordCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={() => {
            void fetchKeywords()
            void fetchDuplicates()
          }}
        />
      </div>
    </TooltipProvider>
  )
}
