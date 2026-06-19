'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Info, Loader2, PackageX } from 'lucide-react'

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

type MirrorItem = {
  optionId: string
  optionName: string
  sku: string | null
  quantity: number
  attributeValues: Record<string, string>
  productName: string
  linkedStock: number | null
  matched: boolean
}

type MirrorListing = {
  id: string
  searchName: string
  displayName: string
  managementName: string | null
  internalCode: string | null
  status: 'ACTIVE' | 'SUSPENDED'
  items: MirrorItem[]
}

type MirrorData =
  | {
      status: 'ok'
      channel: { id: string; name: string }
      representative: { id: string; name: string } | null
      location: { id: string; name: string } | null
      listings: MirrorListing[]
    }
  | { status: 'no_representative'; channel: { id: string; name: string } }
  | { status: 'not_fulfillment'; channel: { id: string; name: string } }

type MatchFilter = 'all' | 'matched' | 'unmatched'

const FILTER_OPTIONS: { value: MatchFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'matched', label: '매칭됨' },
  { value: 'unmatched', label: '미매칭' },
]

export function ChannelMirrorView({ channelId }: { channelId: string }) {
  const [data, setData] = useState<MirrorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<MatchFilter>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/products/listings/mirror?channelId=${channelId}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        setData(null)
        return
      }
      setData(await res.json())
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [channelId])

  useEffect(() => {
    load()
  }, [load])

  // 채널 변경 시 필터 초기화
  useEffect(() => {
    setFilter('all')
  }, [channelId])

  // status==='ok'일 때만 listings 존재 — 필터/정렬 파생값
  const okListings = data?.status === 'ok' ? data.listings : null
  const okHasLocation = data?.status === 'ok' ? !!data.location : false

  // 매칭됨 우선 정렬 + 필터 적용. 매칭 상태는 연동 위치가 있어야 의미가 있으므로,
  // 위치 미연결 시엔 정렬/필터를 적용하지 않고 원본을 그대로 표시한다.
  const visibleListings = useMemo(() => {
    if (!okListings) return []
    if (!okHasLocation) return okListings

    const matchesFilter = (matched: boolean) =>
      filter === 'all' ? true : filter === 'matched' ? matched : !matched

    return (
      okListings
        .map((l) => {
          const items = l.items
            .filter((it) => matchesFilter(it.matched))
            // 매칭됨을 위로
            .sort((a, b) => Number(b.matched) - Number(a.matched))
          return { ...l, items }
        })
        // 표시할 옵션이 없는 상품은 제외
        .filter((l) => l.items.length > 0)
        // 매칭된 옵션이 있는 상품을 위로
        .sort((a, b) => {
          const am = a.items.some((it) => it.matched) ? 1 : 0
          const bm = b.items.some((it) => it.matched) ? 1 : 0
          return bm - am
        })
    )
  }, [okListings, okHasLocation, filter])

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-md border py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        불러오는 중...
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
        미러 데이터를 불러오지 못했습니다
      </div>
    )
  }

  // 대표 채널 미설정 안내
  if (data.status === 'no_representative') {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <PackageX className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">대표 채널이 연결되지 않았습니다</p>
        <p className="mt-1 text-xs text-muted-foreground">
          이 채널은 채널 자체 배송(연동) 채널입니다. 채널 설정에서 대표 채널을 지정하면 대표 채널의
          상품을 읽기전용으로 표시합니다.
        </p>
      </div>
    )
  }

  if (data.status === 'not_fulfillment') {
    return (
      <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
        이 채널은 연동 채널이 아닙니다
      </div>
    )
  }

  // status === 'ok'
  const { representative, location, listings } = data

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          이 채널은{' '}
          <span className="font-medium text-foreground">{representative?.name ?? '대표 채널'}</span>
          의 상품을 읽기전용으로 표시합니다. 재고·배송은 연동 데이터로 자동 처리되며, 채널 재고 수동
          수정은 불필요합니다.
          {location ? (
            <>
              {' '}
              연동 재고는 <span className="font-medium text-foreground">{location.name}</span> 위치
              기준입니다.
            </>
          ) : (
            <> 연동 위치가 아직 연결되지 않아 재고가 표시되지 않습니다.</>
          )}
        </p>
      </div>

      {listings.length === 0 ? (
        <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
          대표 채널에 상품이 없습니다
        </div>
      ) : (
        <>
          {/* 매칭 상태 필터 — 연동 위치가 있을 때만 의미가 있음 */}
          {location && (
            <div className="flex items-center justify-end gap-1">
              <span className="mr-1 text-xs text-muted-foreground">매칭 상태</span>
              {FILTER_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  size="sm"
                  variant={filter === opt.value ? 'default' : 'outline'}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setFilter(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          )}

          {visibleListings.length === 0 ? (
            <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
              {filter === 'matched'
                ? '매칭된 옵션이 없습니다'
                : filter === 'unmatched'
                  ? '미매칭 옵션이 없습니다'
                  : '표시할 상품이 없습니다'}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>상품 / 구성 옵션</TableHead>
                    <TableHead className="w-28 text-right">연동 재고</TableHead>
                    <TableHead className="w-24 text-center">매칭 상태</TableHead>
                    <TableHead className="w-24">판매상태</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleListings.map((l) => (
                    <MirrorListingRows key={l.id} listing={l} hasLocation={!!location} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function MirrorListingRows({
  listing,
  hasLocation,
}: {
  listing: MirrorListing
  hasLocation: boolean
}) {
  const name = listing.managementName?.trim() || listing.searchName
  return (
    <>
      <TableRow className="bg-muted/20">
        <TableCell colSpan={4} className="py-2">
          <span className="text-sm font-medium">{name}</span>
          {listing.internalCode && (
            <span className="ml-2 text-xs text-muted-foreground">{listing.internalCode}</span>
          )}
        </TableCell>
      </TableRow>
      {listing.items.map((it) => (
        <TableRow key={it.optionId}>
          <TableCell className="pl-6">
            <p className="text-sm">
              {it.optionName}
              <span className="ml-1 text-xs text-muted-foreground">×{it.quantity}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {it.productName}
              {it.sku ? ` · ${it.sku}` : ''}
            </p>
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {it.linkedStock != null ? it.linkedStock.toLocaleString('ko-KR') : '-'}
          </TableCell>
          <TableCell className="text-center">
            {!hasLocation ? (
              <span className="text-xs text-muted-foreground">-</span>
            ) : it.matched ? (
              <Badge variant="secondary" className="text-[10px]">
                매칭됨
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-destructive">
                미매칭
              </Badge>
            )}
          </TableCell>
          <TableCell>
            {listing.status === 'SUSPENDED' ? (
              <Badge variant="outline">판매중지</Badge>
            ) : (
              <span className="text-xs text-muted-foreground">판매중</span>
            )}
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}
