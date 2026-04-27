'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Plus, Search } from 'lucide-react'

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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { SELLER_HUB_LISTING_NEW_PATH, getSellerHubListingPath } from '@/lib/deck-routes'

type ListingRow = {
  id: string
  channelId: string
  searchName: string
  displayName: string
  internalCode: string | null
  status: 'ACTIVE' | 'SUSPENDED'
  effectiveStatus: 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'
  retailPrice: number | null
  baselinePrice: number | null
  discountPercent: number | null
  availableStock: number
  itemCount: number
  items: Array<{ optionName: string; productName: string; quantity: number }>
  updatedAt: string
}

type Props = {
  channelId: string | null
}

export function ListingsTable({ channelId }: Props) {
  const [rows, setRows] = useState<ListingRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!channelId) {
      setRows([])
      setTotal(0)
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
        qs.set('pageSize', '50')
        const res = await fetch(`/api/sh/products/listings?${qs.toString()}`)
        if (!res.ok) throw new Error('목록 조회 실패')
        const data: { data: ListingRow[]; total: number } = await res.json()
        if (cancelled) return
        setRows(data.data ?? [])
        setTotal(data.total ?? 0)
      } catch {
        if (!cancelled) {
          setRows([])
          setTotal(0)
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

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>검색명</TableHead>
              <TableHead>노출명</TableHead>
              <TableHead>구성</TableHead>
              <TableHead className="text-right">재고</TableHead>
              <TableHead className="text-right">소비자가</TableHead>
              <TableHead className="text-right">판매가</TableHead>
              <TableHead className="text-right">할인</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  {channelId ? '등록된 판매채널 상품이 없습니다' : '좌측에서 채널을 선택하세요'}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => <ListingRowView key={r.id} row={r} />)
            )}
          </TableBody>
        </Table>
      </div>
      {total > 0 && (
        <p className="text-xs text-muted-foreground">총 {total.toLocaleString('ko-KR')}개</p>
      )}
    </div>
  )
}

function ListingRowView({ row }: { row: ListingRow }) {
  const compositionShort = row.items
    .slice(0, 2)
    .map((it) => `${it.optionName} ×${it.quantity}`)
    .join(' · ')
  const rest = row.items.length - 2
  const compositionTitle = row.items
    .map((it) => `${it.productName} · ${it.optionName} ×${it.quantity}`)
    .join('\n')

  const statusBadge =
    row.effectiveStatus === 'SUSPENDED' ? (
      <Badge variant="outline">판매중지</Badge>
    ) : row.effectiveStatus === 'SOLD_OUT' ? (
      <Badge variant="secondary">품절</Badge>
    ) : (
      <Badge>판매중</Badge>
    )

  return (
    <TableRow className="cursor-pointer hover:bg-muted/40">
      <TableCell>
        <Link href={getSellerHubListingPath(row.id)} className="font-medium hover:underline">
          {row.searchName}
        </Link>
        {row.internalCode && <p className="text-xs text-muted-foreground">{row.internalCode}</p>}
      </TableCell>
      <TableCell className="max-w-[260px]">
        <p className="truncate text-sm">{row.displayName}</p>
      </TableCell>
      <TableCell>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm">
                {compositionShort}
                {rest > 0 && <span className="text-muted-foreground"> · 그 외 {rest}개</span>}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm text-xs whitespace-pre-line">
              {compositionTitle}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TableCell>
      <TableCell className={`text-right ${row.availableStock === 0 ? 'text-destructive' : ''}`}>
        {row.availableStock.toLocaleString('ko-KR')}
      </TableCell>
      <TableCell className="text-right">
        {row.baselinePrice != null ? `${row.baselinePrice.toLocaleString('ko-KR')}원` : '-'}
      </TableCell>
      <TableCell className="text-right">
        {row.retailPrice != null ? `${row.retailPrice.toLocaleString('ko-KR')}원` : '-'}
      </TableCell>
      <TableCell className="text-right">
        {row.discountPercent != null ? `${row.discountPercent.toFixed(1)}%` : '-'}
      </TableCell>
      <TableCell>{statusBadge}</TableCell>
      <TableCell>
        <Link
          href={getSellerHubListingPath(row.id)}
          aria-label={`${row.searchName} 상세`}
          className="inline-flex text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </TableCell>
    </TableRow>
  )
}
