'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  FloatingActionBar,
  floatingActionButtonClass,
  floatingActionButtonDestructiveClass,
} from '@/components/ui/floating-action-bar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
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
import { SELLER_HUB_LISTING_NEW_PATH, getSellerHubChannelProductPath } from '@/lib/deck-routes'
import { applyRangeSelection } from '@/lib/range-selection'

type ProductUnion =
  | { kind: 'single'; id: string; name: string }
  | { kind: 'mixed'; products: Array<{ id: string; name: string }> }

type GroupRow = {
  kind: 'group'
  id: string
  /** backward-compat: product union의 표시명 (API가 채워 줌) */
  productName: string
  /** 백엔드 응답의 product 필드. 없을 수도 있어 optional로 처리 */
  product?: ProductUnion
  baseSearchName: string
  baseManagementName: string | null
  channelId: string
  channelName: string
  listingCount: number
  availableStockSum: number
  retailPriceRange: { min: number | null; max: number | null }
  baselinePriceRange: { min: number | null; max: number | null }
  statusCounts: { ACTIVE: number; SOLD_OUT: number; SUSPENDED: number }
  listings: Array<{
    id: string
    searchName: string
    displayName: string
    managementName: string | null
    internalCode: string | null
    availableStock: number
    baselinePrice: number | null
    retailPrice: number | null
    status: 'ACTIVE' | 'SUSPENDED'
    effectiveStatus: 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'
  }>
}

type SortKey = 'name' | 'count' | 'stock' | 'baseline' | 'retail' | 'status'
type SortDir = 'asc' | 'desc'
type SortState = { key: SortKey; dir: SortDir } | null

function nextSort(prev: SortState, key: SortKey): SortState {
  if (!prev || prev.key !== key) return { key, dir: 'asc' }
  if (prev.dir === 'asc') return { key, dir: 'desc' }
  return null
}

function compareNullableNumber(a: number | null, b: number | null, dir: SortDir): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return dir === 'asc' ? a - b : b - a
}

function compareString(a: string, b: string, dir: SortDir): number {
  const r = a.localeCompare(b, 'ko')
  return dir === 'asc' ? r : -r
}

function statusScore(s: GroupRow['statusCounts']): number {
  return s.ACTIVE * 100 + s.SOLD_OUT * 10 + s.SUSPENDED
}

function nameForSort(g: GroupRow): string {
  return (g.baseManagementName?.trim() || g.productName || '').trim()
}

type Props = {
  channelId: string | null
  productId?: string
}

export function GroupsTable({ channelId, productId }: Props) {
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const lastClickedRowIndex = useRef<number | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' })
  const [bulkAction, setBulkAction] = useState<null | 'suspend' | 'activate' | 'delete'>(null)
  const [bulkLoading, setBulkLoading] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!channelId) {
      setGroups([])
      setSelectedRows(new Set())
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const qs = new URLSearchParams()
        qs.set('channelId', channelId)
        qs.set('status', statusFilter)
        if (productId) qs.set('productId', productId)
        if (debouncedSearch.trim()) qs.set('search', debouncedSearch.trim())
        const res = await fetch(`/api/sh/products/listings/channel-products?${qs.toString()}`)
        if (!res.ok) throw new Error('목록 조회 실패')
        const data: { groups: GroupRow[] } = await res.json()
        if (cancelled) return
        setGroups(data.groups ?? [])
        setSelectedRows(new Set())
      } catch {
        if (!cancelled) {
          setGroups([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [channelId, productId, debouncedSearch, statusFilter, refreshKey])

  const newLinkHref = useMemo(() => {
    const base = SELLER_HUB_LISTING_NEW_PATH
    return channelId ? `${base}?channelId=${channelId}` : base
  }, [channelId])

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function rowKeyForGroup(g: GroupRow): string {
    return `g:${g.id}`
  }

  const displayGroups = useMemo(() => {
    if (!sort) return groups
    const arr = [...groups]
    arr.sort((a, b) => {
      const dir = sort.dir
      switch (sort.key) {
        case 'name':
          return compareString(nameForSort(a), nameForSort(b), dir)
        case 'count':
          return dir === 'asc' ? a.listingCount - b.listingCount : b.listingCount - a.listingCount
        case 'stock':
          return dir === 'asc'
            ? a.availableStockSum - b.availableStockSum
            : b.availableStockSum - a.availableStockSum
        case 'baseline':
          return compareNullableNumber(a.baselinePriceRange.min, b.baselinePriceRange.min, dir)
        case 'retail':
          return compareNullableNumber(a.retailPriceRange.min, b.retailPriceRange.min, dir)
        case 'status':
          return dir === 'asc'
            ? statusScore(a.statusCounts) - statusScore(b.statusCounts)
            : statusScore(b.statusCounts) - statusScore(a.statusCounts)
      }
    })
    return arr
  }, [groups, sort])
  const allRowKeys = useMemo(() => displayGroups.map(rowKeyForGroup), [displayGroups])
  const allSelected = allRowKeys.length > 0 && allRowKeys.every((k) => selectedRows.has(k))
  const someSelected = !allSelected && allRowKeys.some((k) => selectedRows.has(k))

  function toggleSort(key: SortKey) {
    setSort((prev) => nextSort(prev, key))
  }

  function toggleRow(key: string, index: number, shiftKey: boolean) {
    setSelectedRows((prev) =>
      applyRangeSelection(prev, allRowKeys, key, index, shiftKey, lastClickedRowIndex.current)
    )
    lastClickedRowIndex.current = index
  }

  function toggleAllRows(checked: boolean) {
    setSelectedRows(checked ? new Set(allRowKeys) : new Set())
    lastClickedRowIndex.current = null
  }

  // 선택된 row → 영향 listing id 모음 (그룹은 속한 모든 listing)
  const selectedListingIds = useMemo(() => {
    const ids: string[] = []
    for (const g of groups) {
      if (selectedRows.has(rowKeyForGroup(g))) ids.push(...g.listings.map((l) => l.id))
    }
    return ids
  }, [groups, selectedRows])

  // 선택된 listing의 status 분포 (삭제 가드용)
  const selectedListingStatuses = useMemo(() => {
    const statuses: Array<'ACTIVE' | 'SUSPENDED'> = []
    for (const g of groups) {
      if (selectedRows.has(rowKeyForGroup(g))) statuses.push(...g.listings.map((l) => l.status))
    }
    return statuses
  }, [groups, selectedRows])
  const allSelectedSuspended =
    selectedListingStatuses.length > 0 && selectedListingStatuses.every((s) => s === 'SUSPENDED')

  // 삭제 가드: effectiveStatus 기준 (옵션 없거나 품절/중지된 listing은 삭제 허용)
  const selectedEffectiveStatuses = useMemo(() => {
    const statuses: Array<'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'> = []
    for (const g of groups) {
      if (selectedRows.has(rowKeyForGroup(g)))
        statuses.push(...g.listings.map((l) => l.effectiveStatus))
    }
    return statuses
  }, [groups, selectedRows])
  const allSelectedDeletable =
    selectedEffectiveStatuses.length === 0 || selectedEffectiveStatuses.every((s) => s !== 'ACTIVE')

  // 빈 그룹(listings=0) 별도 추적: 삭제 시 ChannelProduct 직접 삭제
  const selectedEmptyGroupIds = useMemo(() => {
    const ids: string[] = []
    for (const g of groups) {
      if (selectedRows.has(rowKeyForGroup(g)) && g.listings.length === 0) ids.push(g.id)
    }
    return ids
  }, [groups, selectedRows])
  const totalSelectedToDelete = selectedListingIds.length + selectedEmptyGroupIds.length

  async function runBulkPatch(status: 'ACTIVE' | 'SUSPENDED') {
    if (selectedListingIds.length === 0) return
    setBulkLoading(true)
    try {
      const res = await fetch('/api/sh/products/listings/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedListingIds, patch: { status } }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message ?? '일괄 변경 실패')
      }
      toast.success(
        status === 'SUSPENDED'
          ? `${selectedListingIds.length}개 판매 옵션을 비활성화했습니다`
          : `${selectedListingIds.length}개 판매 옵션을 활성화했습니다`
      )
      setBulkAction(null)
      setRefreshKey((n) => n + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '일괄 변경 실패')
    } finally {
      setBulkLoading(false)
    }
  }

  async function runBulkDelete() {
    if (totalSelectedToDelete === 0) return
    if (!allSelectedDeletable) {
      toast.error('판매 중인 옵션은 비활성화 후 삭제할 수 있습니다')
      return
    }
    setBulkLoading(true)
    const failures: string[] = []
    await Promise.all([
      ...selectedListingIds.map(async (id) => {
        try {
          const res = await fetch(`/api/sh/products/listings/${id}`, { method: 'DELETE' })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            failures.push(err?.message ?? id)
          }
        } catch (err) {
          failures.push(err instanceof Error ? err.message : id)
        }
      }),
      ...selectedEmptyGroupIds.map(async (id) => {
        try {
          const res = await fetch(`/api/sh/products/listings/channel-products/${id}`, {
            method: 'DELETE',
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            failures.push(err?.message ?? id)
          }
        } catch (err) {
          failures.push(err instanceof Error ? err.message : id)
        }
      }),
    ])
    setBulkLoading(false)
    setBulkAction(null)
    if (failures.length > 0) {
      toast.warning(`일부 삭제 실패 (${failures.length}건)`)
    } else {
      toast.success(`${totalSelectedToDelete}개 항목이 삭제되었습니다`)
    }
    setRefreshKey((n) => n + 1)
  }

  const selectedRowCount = selectedRows.size
  const totalListings = groups.reduce((sum, g) => sum + g.listingCount, 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="관리명·검색명·노출명·관리코드"
              className="w-64 pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 상태</SelectItem>
              <SelectItem value="ACTIVE">판매중</SelectItem>
              <SelectItem value="SOLD_OUT">품절</SelectItem>
              <SelectItem value="SUSPENDED">판매중지</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button asChild disabled={!channelId} size="sm">
          <Link href={newLinkHref}>
            <Plus className="mr-1 h-4 w-4" />새 상품
          </Link>
        </Button>
      </div>

      <FloatingActionBar
        open={selectedRowCount > 0}
        onClear={() => setSelectedRows(new Set())}
        clearDisabled={bulkLoading}
        actions={
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={floatingActionButtonClass}
              onClick={() => setBulkAction(allSelectedSuspended ? 'activate' : 'suspend')}
              disabled={bulkLoading || selectedListingIds.length === 0}
            >
              {allSelectedSuspended ? '활성화' : '비활성화'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={floatingActionButtonDestructiveClass}
              onClick={() => {
                if (!allSelectedDeletable) {
                  toast.error('판매 중인 옵션은 비활성화 후 삭제할 수 있습니다')
                  return
                }
                setBulkAction('delete')
              }}
              disabled={bulkLoading || totalSelectedToDelete === 0}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              삭제
            </Button>
          </>
        }
      >
        <span className="text-sm font-semibold">{selectedRowCount}개 선택됨</span>
        <span className="text-xs text-background/60">
          (영향 옵션 {selectedListingIds.length}개
          {selectedEmptyGroupIds.length > 0 && `, 빈 그룹 ${selectedEmptyGroupIds.length}개`})
        </span>
      </FloatingActionBar>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(v) => toggleAllRows(v === true)}
                  aria-label="전체 선택"
                  disabled={allRowKeys.length === 0}
                />
              </TableHead>
              <TableHead className="w-10" />
              <TableHead>
                <SortableHeaderButton
                  label="상품명"
                  sortKey="name"
                  sort={sort}
                  onToggle={toggleSort}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortableHeaderButton
                  label="구성 수"
                  sortKey="count"
                  sort={sort}
                  onToggle={toggleSort}
                  align="right"
                />
              </TableHead>
              <TableHead className="text-right">
                <SortableHeaderButton
                  label="재고"
                  sortKey="stock"
                  sort={sort}
                  onToggle={toggleSort}
                  align="right"
                />
              </TableHead>
              <TableHead className="text-right">
                <SortableHeaderButton
                  label="소비자가"
                  sortKey="baseline"
                  sort={sort}
                  onToggle={toggleSort}
                  align="right"
                />
              </TableHead>
              <TableHead className="text-right">
                <SortableHeaderButton
                  label="판매가"
                  sortKey="retail"
                  sort={sort}
                  onToggle={toggleSort}
                  align="right"
                />
              </TableHead>
              <TableHead>
                <SortableHeaderButton
                  label="상태"
                  sortKey="status"
                  sort={sort}
                  onToggle={toggleSort}
                />
              </TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  {channelId ? '등록된 판매채널 상품이 없습니다' : '좌측에서 채널을 선택하세요'}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {displayGroups.map((g, gi) => {
                  const key = g.id
                  const isOpen = expanded.has(key)
                  const rowKey = rowKeyForGroup(g)
                  return (
                    <GroupRowView
                      key={key}
                      group={g}
                      isOpen={isOpen}
                      onToggle={() => toggleGroup(key)}
                      isSelected={selectedRows.has(rowKey)}
                      onToggleSelect={(shiftKey) => toggleRow(rowKey, gi, shiftKey)}
                    />
                  )
                })}
              </>
            )}
          </TableBody>
        </Table>
      </div>
      {totalListings > 0 && (
        <p className="text-xs text-muted-foreground">
          총 {groups.length.toLocaleString('ko-KR')}개 채널 상품 ·{' '}
          {totalListings.toLocaleString('ko-KR')}개 판매 옵션
        </p>
      )}

      <Dialog
        open={bulkAction === 'suspend' || bulkAction === 'activate'}
        onOpenChange={(v) => {
          if (!v && !bulkLoading) setBulkAction(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              판매채널 상품 {bulkAction === 'activate' ? '활성화' : '비활성화'}
            </DialogTitle>
            <DialogDescription>
              선택한 <span className="font-medium">{selectedRowCount}개</span> 채널 상품(판매 옵션{' '}
              <span className="font-medium">{selectedListingIds.length}개</span>)의 판매상태를 일괄{' '}
              <span className="font-medium">
                {bulkAction === 'activate' ? '판매중(ACTIVE)' : '판매중지(SUSPENDED)'}
              </span>
              로 변경합니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAction(null)} disabled={bulkLoading}>
              취소
            </Button>
            <Button
              onClick={() => runBulkPatch(bulkAction === 'activate' ? 'ACTIVE' : 'SUSPENDED')}
              disabled={bulkLoading}
            >
              {bulkLoading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {bulkAction === 'activate' ? '활성화' : '비활성화'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkAction === 'delete'}
        onOpenChange={(v) => {
          if (!v && !bulkLoading) setBulkAction(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>판매채널 상품 삭제</DialogTitle>
            <DialogDescription>
              선택한 <span className="font-medium">{selectedRowCount}개</span> 채널 상품(판매 옵션{' '}
              <span className="font-medium">{selectedListingIds.length}개</span>
              {selectedEmptyGroupIds.length > 0 && (
                <>
                  , 빈 그룹 <span className="font-medium">{selectedEmptyGroupIds.length}개</span>
                </>
              )}
              )을 모두 삭제합니다.
              <br />• 매칭된 배송 별칭(alias)도 함께 삭제됩니다.
              <br />• 이미 매칭된 배송 주문은 해당 옵션 연결만 해제됩니다 (이력 보존).
              <br />이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAction(null)} disabled={bulkLoading}>
              취소
            </Button>
            <Button variant="destructive" onClick={runBulkDelete} disabled={bulkLoading}>
              {bulkLoading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function formatRange(r: { min: number | null; max: number | null }) {
  if (r.min == null && r.max == null) return '-'
  if (r.min == null || r.max == null) return `${(r.min ?? r.max)!.toLocaleString('ko-KR')}원`
  if (r.min === r.max) return `${r.min.toLocaleString('ko-KR')}원`
  return `${r.min.toLocaleString('ko-KR')} ~ ${r.max.toLocaleString('ko-KR')}원`
}

function GroupRowView({
  group,
  isOpen,
  onToggle,
  isSelected,
  onToggleSelect,
}: {
  group: GroupRow
  isOpen: boolean
  onToggle: () => void
  isSelected: boolean
  onToggleSelect: (shiftKey: boolean) => void
}) {
  const router = useRouter()
  const groupHref = getSellerHubChannelProductPath(group.id)
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => router.push(groupHref)}>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onClick={(e: React.MouseEvent) => onToggleSelect(e.shiftKey)}
            onCheckedChange={() => {}}
            aria-label={`${group.baseManagementName ?? group.productName} 선택`}
          />
        </TableCell>
        <TableCell>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={isOpen ? '접기' : '펼치기'}
          >
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>
        <TableCell>
          <p className="font-medium">{group.baseManagementName?.trim() || group.productName}</p>
          {(() => {
            // product union이 있으면 정확한 표시, 없으면 backward-compat productName 사용
            const displayProductName =
              group.product?.kind === 'mixed'
                ? `혼합 (${group.product.products.length}개 상품)`
                : group.product?.kind === 'single'
                  ? group.product.name
                  : group.productName
            const showSub =
              group.baseManagementName?.trim() &&
              group.baseManagementName.trim() !== displayProductName
            return showSub ? (
              <p className="text-xs text-muted-foreground">상품: {displayProductName}</p>
            ) : null
          })()}
          <p className="text-xs text-muted-foreground">{group.channelName}</p>
        </TableCell>
        <TableCell className="text-right text-sm">{group.listingCount}</TableCell>
        <TableCell
          className={`text-right ${group.availableStockSum === 0 ? 'text-destructive' : ''}`}
        >
          {group.availableStockSum.toLocaleString('ko-KR')}
        </TableCell>
        <TableCell className="text-right text-sm text-muted-foreground">
          {formatRange(group.baselinePriceRange)}
        </TableCell>
        <TableCell className="text-right text-sm">{formatRange(group.retailPriceRange)}</TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {group.statusCounts.ACTIVE > 0 && <Badge>판매 {group.statusCounts.ACTIVE}</Badge>}
            {group.statusCounts.SOLD_OUT > 0 && (
              <Badge variant="secondary">품절 {group.statusCounts.SOLD_OUT}</Badge>
            )}
            {group.statusCounts.SUSPENDED > 0 && (
              <Badge variant="outline">중지 {group.statusCounts.SUSPENDED}</Badge>
            )}
          </div>
        </TableCell>
        <TableCell>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </TableCell>
      </TableRow>
      {isOpen &&
        group.listings.map((l) => {
          const badge =
            l.effectiveStatus === 'SUSPENDED' ? (
              <Badge variant="outline">판매중지</Badge>
            ) : l.effectiveStatus === 'SOLD_OUT' ? (
              <Badge variant="secondary">품절</Badge>
            ) : (
              <Badge>판매중</Badge>
            )
          return (
            <TableRow key={l.id} className="bg-muted/20">
              <TableCell />
              <TableCell />
              <TableCell className="pl-8 text-sm">
                {l.managementName?.trim() || l.searchName}
                {l.managementName?.trim() && l.managementName.trim() !== l.searchName && (
                  <p className="text-xs text-muted-foreground">검색명: {l.searchName}</p>
                )}
                {l.internalCode && (
                  <p className="text-xs text-muted-foreground">{l.internalCode}</p>
                )}
              </TableCell>
              <TableCell />
              <TableCell
                className={`text-right text-sm ${l.availableStock === 0 ? 'text-destructive' : ''}`}
              >
                {l.availableStock.toLocaleString('ko-KR')}
              </TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">
                {l.baselinePrice != null ? `${l.baselinePrice.toLocaleString('ko-KR')}원` : '-'}
              </TableCell>
              <TableCell className="text-right text-sm">
                {l.retailPrice != null ? `${l.retailPrice.toLocaleString('ko-KR')}원` : '-'}
              </TableCell>
              <TableCell>{badge}</TableCell>
              <TableCell />
            </TableRow>
          )
        })}
    </>
  )
}

function SortableHeaderButton({
  label,
  sortKey,
  sort,
  onToggle,
  align,
}: {
  label: string
  sortKey: SortKey
  sort: SortState
  onToggle: (k: SortKey) => void
  align?: 'right'
}) {
  const active = sort?.key === sortKey
  const dir = active ? sort!.dir : null
  const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className={`inline-flex items-center gap-1 hover:text-foreground ${
        active ? 'text-foreground' : 'text-muted-foreground'
      } ${align === 'right' ? 'ml-auto' : ''}`}
    >
      <span>{label}</span>
      <Icon className={`h-3 w-3 ${active ? '' : 'opacity-50'}`} />
    </button>
  )
}
