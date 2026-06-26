'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { StockProductSummary } from './stock-status.types'

type Props = {
  products: StockProductSummary[]
  loading?: boolean
  selectedProductId: string | null
  onSelectProduct: (productId: string | null) => void
}

const KRW = new Intl.NumberFormat('ko-KR')

/** 심각도 기준 정렬: 결품 > 부족 > 과잉 > 정상 */
function sortProducts(products: StockProductSummary[]): StockProductSummary[] {
  return [...products].sort((a, b) => {
    // 문제 있는 상품 우선
    const aScore = a.outOptionCount * 100 + a.lowOptionCount * 10 + a.overOptionCount
    const bScore = b.outOptionCount * 100 + b.lowOptionCount * 10 + b.overOptionCount
    if (bScore !== aScore) return bScore - aScore
    // 점수 같으면 상품명 오름차순
    return a.productName.localeCompare(b.productName, 'ko')
  })
}

export function StockStatusProducts({
  products,
  loading,
  selectedProductId,
  onSelectProduct,
}: Props) {
  const [query, setQuery] = useState('')
  const sorted = useMemo(() => sortProducts(products), [products])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((p) => p.productName.toLowerCase().includes(q))
  }, [query, sorted])

  const totals = useMemo(
    () =>
      products.reduce(
        (acc, p) => ({
          optionCount: acc.optionCount + p.optionCount,
          okOptionCount: acc.okOptionCount + p.okOptionCount,
          lowOptionCount: acc.lowOptionCount + p.lowOptionCount,
          outOptionCount: acc.outOptionCount + p.outOptionCount,
          overOptionCount: acc.overOptionCount + p.overOptionCount,
        }),
        {
          optionCount: 0,
          okOptionCount: 0,
          lowOptionCount: 0,
          outOptionCount: 0,
          overOptionCount: 0,
        }
      ),
    [products]
  )

  return (
    <Card className="flex min-h-[560px] overflow-hidden">
      <CardHeader className="border-b">
        <CardTitle className="text-sm">상품</CardTitle>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="상품 검색"
          className="mt-2 h-9"
        />
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">상품 데이터가 없습니다</p>
        ) : (
          <div className="space-y-1">
            <ProductButton
              active={selectedProductId === null}
              name="전체"
              optionCount={totals.optionCount}
              outOptionCount={totals.outOptionCount}
              lowOptionCount={totals.lowOptionCount}
              overOptionCount={totals.overOptionCount}
              okOptionCount={totals.okOptionCount}
              onClick={() => onSelectProduct(null)}
            />
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                검색 결과가 없습니다
              </p>
            ) : (
              filtered.map((p) => (
                <ProductButton
                  key={p.productId}
                  active={selectedProductId === p.productId}
                  name={p.productName}
                  optionCount={p.optionCount}
                  outOptionCount={p.outOptionCount}
                  lowOptionCount={p.lowOptionCount}
                  overOptionCount={p.overOptionCount}
                  okOptionCount={p.okOptionCount}
                  onClick={() => onSelectProduct(p.productId)}
                />
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

type ProductButtonProps = {
  active: boolean
  name: string
  optionCount: number
  outOptionCount: number
  lowOptionCount: number
  overOptionCount: number
  okOptionCount: number
  onClick: () => void
}

function ProductButton({
  active,
  name,
  optionCount,
  outOptionCount,
  lowOptionCount,
  overOptionCount,
  okOptionCount,
  onClick,
}: ProductButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50',
        active ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-card'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{name}</span>
        <span
          className={cn(
            'font-mono text-xs tabular-nums',
            active ? 'text-primary-foreground/80' : 'text-muted-foreground'
          )}
        >
          {KRW.format(optionCount)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1">
        <StatusCount label="결품" count={outOptionCount} variant="out" active={active} />
        <StatusCount label="부족" count={lowOptionCount} variant="low" active={active} />
        <StatusCount label="과잉" count={overOptionCount} variant="over" active={active} />
        <StatusCount label="정상" count={okOptionCount} variant="ok" active={active} />
      </div>
    </button>
  )
}

function StatusCount({
  label,
  count,
  variant,
  active,
}: {
  label: string
  count: number
  variant: BadgeVariant
  active: boolean
}) {
  return (
    <span className={cn('flex flex-col gap-1 rounded border px-1.5 py-1', active && 'bg-white/10')}>
      <span className={cn('text-[10px]', active ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
        {label}
      </span>
      <OptionCountBadge count={count} variant={variant} />
    </span>
  )
}

type BadgeVariant = 'out' | 'low' | 'over' | 'ok'

const BADGE_CLASSES: Record<BadgeVariant, string> = {
  out: 'border-red-300 bg-red-50 text-red-700',
  low: 'border-amber-300 bg-amber-50 text-amber-700',
  over: 'border-indigo-300 bg-indigo-50 text-indigo-700',
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-700',
}

function OptionCountBadge({ count, variant }: { count: number; variant: BadgeVariant }) {
  if (count === 0) {
    return <span className="font-mono text-xs text-muted-foreground/40 tabular-nums">—</span>
  }
  return (
    <Badge
      variant="outline"
      className={cn('font-mono text-[11px] tabular-nums', BADGE_CLASSES[variant])}
    >
      {KRW.format(count)}
    </Badge>
  )
}
