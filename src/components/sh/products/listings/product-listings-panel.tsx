'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'

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
import { SELLER_HUB_LISTING_NEW_PATH, getSellerHubListingPath } from '@/lib/deck-routes'

type ListingForProduct = {
  listingId: string
  channelId: string
  channelName: string
  searchName: string
  displayName: string
  retailPrice: number | null
  baselinePrice: number | null
  availableStock: number
  status: 'ACTIVE' | 'SUSPENDED'
  effectiveStatus: 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'
  itemCount: number
  myOptionsInListing: Array<{ optionId: string; optionName: string; quantity: number }>
}

type Props = {
  productId: string
}

export function ProductListingsPanel({ productId }: Props) {
  const [rows, setRows] = useState<ListingForProduct[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/sh/products/${productId}/listings`)
        if (!res.ok) throw new Error('조회 실패')
        const data: { data: ListingForProduct[] } = await res.json()
        if (!cancelled) setRows(data.data ?? [])
      } catch {
        if (!cancelled) setRows([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [productId])

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  if (rows.length === 0) {
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
            <TableHead>채널</TableHead>
            <TableHead>검색명</TableHead>
            <TableHead>이 상품의 구성</TableHead>
            <TableHead className="text-right">판매가</TableHead>
            <TableHead className="text-right">재고</TableHead>
            <TableHead>상태</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const composition = r.myOptionsInListing
              .map((o) => `${o.optionName} ×${o.quantity}`)
              .join(' · ')
            const statusBadge =
              r.effectiveStatus === 'SUSPENDED' ? (
                <Badge variant="outline">판매중지</Badge>
              ) : r.effectiveStatus === 'SOLD_OUT' ? (
                <Badge variant="secondary">품절</Badge>
              ) : (
                <Badge>판매중</Badge>
              )
            return (
              <TableRow key={r.listingId} className="hover:bg-muted/40">
                <TableCell className="text-sm">{r.channelName}</TableCell>
                <TableCell>
                  <Link
                    href={getSellerHubListingPath(r.listingId)}
                    className="font-medium hover:underline"
                  >
                    {r.searchName}
                  </Link>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{composition}</TableCell>
                <TableCell className="text-right">
                  {r.retailPrice != null ? `${r.retailPrice.toLocaleString('ko-KR')}원` : '-'}
                </TableCell>
                <TableCell
                  className={`text-right ${r.availableStock === 0 ? 'text-destructive' : ''}`}
                >
                  {r.availableStock.toLocaleString('ko-KR')}
                </TableCell>
                <TableCell>{statusBadge}</TableCell>
                <TableCell>
                  <Link
                    href={getSellerHubListingPath(r.listingId)}
                    aria-label={`${r.searchName} 상세`}
                    className="inline-flex text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
