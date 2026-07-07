'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BLOG_OPS_PRODUCTS_PATH } from '@/lib/deck-routes'

type CrawlStatus = 'NONE' | 'PENDING' | 'DONE' | 'FAILED'

type ProductRow = {
  id: string
  name: string
  category: string | null
  oneLinerPitch: string | null
  homepageUrl: string | null
  crawlStatus: CrawlStatus
  crawledAt: Date | string | null
  isActive: boolean
  updatedAt: Date | string
}

type Props = {
  products: ProductRow[]
}

// 크롤 상태 배지 색상 — 라이트/다크 쌍
function crawlStatusBadge(status: CrawlStatus) {
  switch (status) {
    case 'NONE':
      return (
        <Badge variant="secondary" className="text-xs">
          미수집
        </Badge>
      )
    case 'PENDING':
      return (
        <Badge className="border-blue-200 bg-blue-100 text-xs text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          수집 중
        </Badge>
      )
    case 'DONE':
      return (
        <Badge className="border-emerald-200 bg-emerald-100 text-xs text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          수집 완료
        </Badge>
      )
    case 'FAILED':
      return (
        <Badge className="border-red-200 bg-red-100 text-xs text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300">
          수집 실패
        </Badge>
      )
  }
}

function formatDate(d: Date | string | null) {
  if (!d) return null
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(d))
}

export function ProductList({ products }: Props) {
  if (products.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            아직 등록된 제품이 없습니다. 첫 제품을 등록해 블로그 소재를 발굴하세요.
          </p>
          <Button asChild className="mt-4">
            <Link href={`${BLOG_OPS_PRODUCTS_PATH}/new`}>제품 추가</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {products.map((p) => (
        <Link
          key={p.id}
          href={`${BLOG_OPS_PRODUCTS_PATH}/${p.id}`}
          className="block rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:bg-accent"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold">{p.name}</h3>
                {p.category && (
                  <Badge variant="outline" className="text-xs">
                    {p.category}
                  </Badge>
                )}
                {crawlStatusBadge(p.crawlStatus)}
              </div>
              {p.oneLinerPitch && (
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{p.oneLinerPitch}</p>
              )}
              {p.homepageUrl && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.homepageUrl}</p>
              )}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDate(p.updatedAt)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}

// ─── 크롤 버튼 (클라이언트 컴포넌트) ────────────────────────────────────────

type CrawlButtonProps = {
  productId: string
  disabled?: boolean
  onDone?: () => void
}

export function CrawlButton({ productId, disabled, onDone }: CrawlButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCrawl() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/bo/products/${productId}/crawl`, { method: 'POST' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({ message: '크롤링 실패' }))
        throw new Error(json.message || '크롤링 실패')
      }
      onDone?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleCrawl}
        disabled={disabled || loading}
      >
        {loading ? '수집 중…' : '홈페이지 크롤링'}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
