'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { InvProductLike } from '@/lib/sc/product-import/map-inv-product'

// seller-ops 상품 검색·선택. 전용 API 를 만들지 않고 seller-hub 목록을 그대로 호출한다.
// 그 라우트는 resolveDeckContext('seller-hub') 게이트라 덱이 꺼진 스페이스에서는 403 이 온다.
// includeName=1 이 없으면 검색이 관리명(internalName)만 보므로 반드시 붙인다.

type Row = InvProductLike & { id: string; internalName?: string | null }

type Props = {
  onPick: (product: Row) => void
}

const PAGE_SIZE = 20

export function SellerOpsProductPicker({ onPick }: Props) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        includeName: '1',
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (debounced) params.set('search', debounced)
      const res = await fetch(`/api/sh/products?${params}`, { cache: 'no-store' })
      if (res.status === 403) {
        throw new Error('세일즈 운영 카드가 활성화되어 있지 않습니다')
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || '상품을 불러오지 못했습니다')
      setRows(json.data ?? [])
      setTotal(json.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : '상품을 불러오지 못했습니다')
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [debounced, page])

  useEffect(() => {
    void load()
  }, [load])

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="상품명·브랜드·코드로 검색"
          className="pl-9"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="max-h-80 divide-y overflow-y-auto rounded-md border">
        {loading && (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
          </div>
        )}
        {!loading && rows.length === 0 && !error && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {debounced ? '검색 결과가 없습니다' : '등록된 상품이 없습니다'}
          </p>
        )}
        {!loading &&
          rows.map((row) => {
            const official = typeof row.name === 'string' ? row.name : ''
            const internal = row.internalName ?? ''
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onPick(row)}
                className="flex w-full flex-col items-start gap-0.5 p-3 text-left transition hover:bg-muted/60"
              >
                <span className="text-sm font-medium">{official || internal || '(이름 없음)'}</span>
                {internal && internal !== official && (
                  <span className="text-xs text-muted-foreground">관리명: {internal}</span>
                )}
              </button>
            )
          })}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {total.toLocaleString('ko-KR')}개 중 {page}/{lastPage} 페이지
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              이전
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= lastPage || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
