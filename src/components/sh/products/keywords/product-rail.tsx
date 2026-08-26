'use client'

// 상품 축 키워드 화면의 좌측 레일 — 검색 + 페이지네이션 목록으로 상품을 고른다.
// 구조는 channel-rail.tsx 를 따른다.

import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const PAGE_SIZE = 30

type ProductRow = {
  id: string
  name: string
  brandName: string | null
  channelCount: number
}

type Props = {
  selectedProductId: string | null
  onSelectProduct: (id: string) => void
}

export function ProductRail({ selectedProductId, onSelectProduct }: Props) {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [products, setProducts] = useState<ProductRow[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // 재시도 버튼은 debounced/page 를 안 바꿀 수도 있어(예: page 1 실패) 별도 카운터로 effect 를 다시 태운다.
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const qs = new URLSearchParams()
        qs.set('page', String(page))
        qs.set('pageSize', String(PAGE_SIZE))
        if (debounced.trim()) qs.set('q', debounced.trim())
        const res = await fetch(`/api/sh/products/keyword-overview?${qs.toString()}`)
        if (!res.ok) throw new Error('상품 조회 실패')
        const data: { data: ProductRow[]; total: number } = await res.json()
        if (cancelled) return
        setError(false)
        setTotal(data.total ?? 0)
        setProducts((prev) => (page > 1 ? [...prev, ...(data.data ?? [])] : (data.data ?? [])))
        if (page === 1 && !selectedProductId && (data.data ?? []).length > 0) {
          onSelectProduct(data.data[0].id)
        }
      } catch {
        if (!cancelled) {
          setError(true)
          setProducts([])
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, page, refreshKey])

  const hasMore = products.length < total

  return (
    <div>
      <div className="mb-2 space-y-2">
        <span className="text-xs font-medium text-muted-foreground">상품</span>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="상품명으로 검색"
          className="h-8 text-sm"
        />
      </div>
      {loading && page === 1 ? (
        <p className="px-2 text-sm text-muted-foreground">불러오는 중...</p>
      ) : error && products.length === 0 ? (
        <div className="space-y-2 px-2">
          <p className="text-sm text-muted-foreground">목록을 불러오지 못했습니다</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((n) => n + 1)}
          >
            다시 시도
          </Button>
        </div>
      ) : products.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">상품이 없습니다</p>
      ) : (
        <ul className="space-y-1">
          {products.map((p) => {
            const isSelected = p.id === selectedProductId
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelectProduct(p.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`w-full rounded-md px-2 py-2 text-left text-sm transition ${
                    isSelected ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted/60'
                  }`}
                >
                  <p className="truncate">{p.name}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    {p.brandName && <span className="truncate">{p.brandName}</span>}
                    {p.brandName && <span>·</span>}
                    <Badge variant={isSelected ? 'default' : 'secondary'} className="shrink-0">
                      채널 {p.channelCount}개
                    </Badge>
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {hasMore && (
        <div className="mt-2 text-center">
          {loading ? (
            <span className="text-sm text-muted-foreground">불러오는 중...</span>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setPage((p) => p + 1)}>
              더 보기
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
