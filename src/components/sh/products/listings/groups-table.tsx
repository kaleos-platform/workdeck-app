'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  SELLER_HUB_LISTING_NEW_PATH,
  getSellerHubListingGroupPath,
  getSellerHubListingPath,
} from '@/lib/deck-routes'

type GroupRow = {
  kind: 'group'
  productId: string
  productName: string
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
    internalCode: string | null
    availableStock: number
    baselinePrice: number | null
    retailPrice: number | null
    status: 'ACTIVE' | 'SUSPENDED'
    effectiveStatus: 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'
  }>
}

type MixedRow = {
  kind: 'mixed'
  id: string
  channelId: string
  channelName: string
  searchName: string
  displayName: string
  availableStock: number
  baselinePrice: number | null
  retailPrice: number | null
  status: 'ACTIVE' | 'SUSPENDED'
  effectiveStatus: 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'
}

type Props = {
  channelId: string | null
}

export function GroupsTable({ channelId }: Props) {
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [mixed, setMixed] = useState<MixedRow[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!channelId) {
      setGroups([])
      setMixed([])
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const qs = new URLSearchParams()
        qs.set('channelId', channelId)
        qs.set('status', statusFilter)
        if (debouncedSearch.trim()) qs.set('search', debouncedSearch.trim())
        const res = await fetch(`/api/sh/products/listings/groups?${qs.toString()}`)
        if (!res.ok) throw new Error('목록 조회 실패')
        const data: { groups: GroupRow[]; mixed: MixedRow[] } = await res.json()
        if (cancelled) return
        setGroups(data.groups ?? [])
        setMixed(data.mixed ?? [])
      } catch {
        if (!cancelled) {
          setGroups([])
          setMixed([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [channelId, debouncedSearch, statusFilter])

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

  const totalListings = groups.reduce((sum, g) => sum + g.listingCount, 0) + mixed.length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="검색명·노출명·관리코드"
              className="w-64 pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 상태</SelectItem>
              <SelectItem value="ACTIVE">판매중 포함</SelectItem>
              <SelectItem value="SOLD_OUT">품절 포함</SelectItem>
              <SelectItem value="SUSPENDED">판매중지 포함</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button asChild disabled={!channelId} size="sm">
          <Link href={newLinkHref}>
            <Plus className="mr-1 h-4 w-4" />새 상품
          </Link>
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>상품 / 검색명</TableHead>
              <TableHead className="text-right">구성 수</TableHead>
              <TableHead className="text-right">재고</TableHead>
              <TableHead className="text-right">소비자가</TableHead>
              <TableHead className="text-right">판매가</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && groups.length === 0 && mixed.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : groups.length === 0 && mixed.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  {channelId ? '등록된 판매채널 상품이 없습니다' : '좌측에서 채널을 선택하세요'}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {groups.map((g) => {
                  const key = `${g.productId}:${g.channelId}`
                  const isOpen = expanded.has(key)
                  return (
                    <GroupRowView
                      key={key}
                      group={g}
                      isOpen={isOpen}
                      onToggle={() => toggleGroup(key)}
                    />
                  )
                })}
                {mixed.length > 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="bg-muted/30 py-2 text-xs text-muted-foreground"
                    >
                      혼합 구성 listing ({mixed.length}개) — 단일 편집 폼에서 개별 관리
                    </TableCell>
                  </TableRow>
                )}
                {mixed.map((m) => (
                  <MixedRowView key={m.id} mixed={m} />
                ))}
              </>
            )}
          </TableBody>
        </Table>
      </div>
      {totalListings > 0 && (
        <p className="text-xs text-muted-foreground">
          총 {groups.length.toLocaleString('ko-KR')}개 상품 그룹 ·{' '}
          {totalListings.toLocaleString('ko-KR')}개 listing
          {mixed.length > 0 ? ` · 혼합 ${mixed.length}` : ''}
        </p>
      )}
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
}: {
  group: GroupRow
  isOpen: boolean
  onToggle: () => void
}) {
  const router = useRouter()
  const groupHref = getSellerHubListingGroupPath(group.productId, group.channelId)
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => router.push(groupHref)}>
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
          <p className="font-medium">{group.productName}</p>
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
              <TableCell className="pl-8 text-sm">
                {l.searchName}
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

function MixedRowView({ mixed }: { mixed: MixedRow }) {
  const badge =
    mixed.effectiveStatus === 'SUSPENDED' ? (
      <Badge variant="outline">판매중지</Badge>
    ) : mixed.effectiveStatus === 'SOLD_OUT' ? (
      <Badge variant="secondary">품절</Badge>
    ) : (
      <Badge>판매중</Badge>
    )
  return (
    <TableRow className="hover:bg-muted/40">
      <TableCell />
      <TableCell>
        <Link
          href={getSellerHubListingPath(mixed.id)}
          className="text-sm font-medium hover:underline"
        >
          {mixed.searchName}
        </Link>
        <p className="text-xs text-muted-foreground">{mixed.channelName} · 혼합 구성</p>
      </TableCell>
      <TableCell className="text-right text-sm">-</TableCell>
      <TableCell
        className={`text-right text-sm ${mixed.availableStock === 0 ? 'text-destructive' : ''}`}
      >
        {mixed.availableStock.toLocaleString('ko-KR')}
      </TableCell>
      <TableCell className="text-right text-sm text-muted-foreground">
        {mixed.baselinePrice != null ? `${mixed.baselinePrice.toLocaleString('ko-KR')}원` : '-'}
      </TableCell>
      <TableCell className="text-right text-sm">
        {mixed.retailPrice != null ? `${mixed.retailPrice.toLocaleString('ko-KR')}원` : '-'}
      </TableCell>
      <TableCell>{badge}</TableCell>
      <TableCell>
        <Link
          href={getSellerHubListingPath(mixed.id)}
          aria-label={`${mixed.searchName} 상세`}
          className="inline-flex text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </TableCell>
    </TableRow>
  )
}
