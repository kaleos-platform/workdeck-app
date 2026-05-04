'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

type ListingRow = {
  id: string
  searchName: string
  displayName: string
  managementName: string | null
  retailPrice: number | null
  baselinePrice: number | null
  availableStock: number
  channelAllocation: number | null
  status: 'ACTIVE' | 'SUSPENDED'
  effectiveStatus: 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'
  myOptionsInListing: Array<{ optionId: string; optionName: string; quantity: number }>
}

type GroupRow = {
  channelId: string
  channelName: string
  listingCount: number
  availableStockSum: number
  retailPriceRange: { min: number | null; max: number | null }
  baselinePriceRange: { min: number | null; max: number | null }
  statusCounts: { ACTIVE: number; SOLD_OUT: number; SUSPENDED: number }
  listings: ListingRow[]
}

type MixedRow = ListingRow & { channelId: string; channelName: string }

type Props = {
  productId: string
}

export function ProductListingsPanel({ productId }: Props) {
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [mixed, setMixed] = useState<MixedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/sh/products/${productId}/listings`)
        if (!res.ok) throw new Error('조회 실패')
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
  }, [productId])

  function toggleGroup(channelId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(channelId)) next.delete(channelId)
      else next.add(channelId)
      return next
    })
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  if (groups.length === 0 && mixed.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-10 text-center">
        <p className="text-sm text-muted-foreground">
          이 상품은 아직 판매채널 상품에 등록되지 않았습니다
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href={SELLER_HUB_LISTING_NEW_PATH}>
            <Plus className="mr-1 h-4 w-4" />
            판매채널 상품 등록
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>채널 · 상품 그룹</TableHead>
            <TableHead className="text-right">구성 수</TableHead>
            <TableHead className="text-right">재고</TableHead>
            <TableHead className="text-right">소비자가</TableHead>
            <TableHead className="text-right">판매가</TableHead>
            <TableHead>상태</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => {
            const isOpen = expanded.has(g.channelId)
            return (
              <GroupRowView
                key={g.channelId}
                productId={productId}
                group={g}
                isOpen={isOpen}
                onToggle={() => toggleGroup(g.channelId)}
              />
            )
          })}
          {mixed.length > 0 && (
            <TableRow>
              <TableCell colSpan={8} className="bg-muted/30 py-2 text-xs text-muted-foreground">
                혼합 구성 listing ({mixed.length}개) — 단일 편집 폼에서 개별 관리
              </TableCell>
            </TableRow>
          )}
          {mixed.map((m) => (
            <MixedRowView key={m.id} mixed={m} />
          ))}
        </TableBody>
      </Table>
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
  productId,
  group,
  isOpen,
  onToggle,
}: {
  productId: string
  group: GroupRow
  isOpen: boolean
  onToggle: () => void
}) {
  const router = useRouter()
  const groupHref = getSellerHubListingGroupPath(productId, group.channelId)
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
          <p className="font-medium">{group.channelName}</p>
          <p className="text-xs text-muted-foreground">
            상품 그룹 · {group.listingCount}개 listing
          </p>
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
          const composition = l.myOptionsInListing
            .map((o) => `${o.optionName} ×${o.quantity}`)
            .join(' · ')
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
                {l.managementName?.trim() || l.searchName}
                {l.managementName?.trim() && l.managementName.trim() !== l.searchName && (
                  <p className="text-xs text-muted-foreground">검색명: {l.searchName}</p>
                )}
                {composition && <p className="text-xs text-muted-foreground">{composition}</p>}
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
  const composition = mixed.myOptionsInListing
    .map((o) => `${o.optionName} ×${o.quantity}`)
    .join(' · ')
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
          {mixed.managementName?.trim() || mixed.searchName}
        </Link>
        <p className="text-xs text-muted-foreground">
          {mixed.channelName} · 혼합 구성{composition ? ` · ${composition}` : ''}
        </p>
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
