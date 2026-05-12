'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { HealthDistribution, StockBrand } from './stock-status.types'

type Props = {
  brands: StockBrand[]
  selectedBrandId: string | null
  selectedGroupId: string | null
  onSelect: (next: { brandId?: string | null; groupId?: string | null }) => void
  loading: boolean
}

const KRW = new Intl.NumberFormat('ko-KR')
const OPEN_STORAGE_KEY = 'wd:inv:tree-open'

function HealthBar({ dist }: { dist: HealthDistribution }) {
  if (dist.total === 0) {
    return <span className="block h-1 w-12 rounded-full bg-muted" />
  }
  const okPct = (dist.ok / dist.total) * 100
  const lowPct = (dist.low / dist.total) * 100
  const outPct = (dist.out / dist.total) * 100
  return (
    <span
      className="flex h-1 w-12 overflow-hidden rounded-full bg-muted"
      title={`정상 ${dist.ok} · 부족 ${dist.low} · 결품 ${dist.out}`}
    >
      <span className="h-full bg-emerald-500" style={{ width: `${okPct}%` }} />
      <span className="h-full bg-amber-500" style={{ width: `${lowPct}%` }} />
      <span className="h-full bg-red-500" style={{ width: `${outPct}%` }} />
    </span>
  )
}

export function StockStatusTree({
  brands,
  selectedBrandId,
  selectedGroupId,
  onSelect,
  loading,
}: Props) {
  const [openSet, setOpenSet] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const raw = localStorage.getItem(OPEN_STORAGE_KEY)
      if (!raw) return new Set()
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((x): x is string => typeof x === 'string'))
      }
      return new Set()
    } catch {
      return new Set()
    }
  })

  function toggleOpen(brandKey: string) {
    setOpenSet((prev) => {
      const next = new Set(prev)
      if (next.has(brandKey)) next.delete(brandKey)
      else next.add(brandKey)
      try {
        localStorage.setItem(OPEN_STORAGE_KEY, JSON.stringify(Array.from(next)))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const totalSkus = brands.reduce((s, b) => s + b.groups.reduce((gs, g) => gs + g.skuCount, 0), 0)

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          브랜드 · 카테고리
          <span className="text-xs font-normal text-muted-foreground">
            · {brands.length}개 브랜드 · {KRW.format(totalSkus)} SKU
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : brands.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">등록된 상품이 없습니다</p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto">
            {brands.map((brand) => {
              const brandKey = brand.id ?? '__none__'
              const isOpen = openSet.has(brandKey)
              const brandTotalQty = brand.groups.reduce((s, g) => s + g.totalQty, 0)
              const isBrandSelected = selectedBrandId === brand.id
              return (
                <div key={brandKey} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggleOpen(brandKey)}
                    className={cn(
                      'flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/40',
                      isBrandSelected && 'bg-muted/60'
                    )}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span
                      className="font-medium"
                      role="link"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect({
                          brandId: isBrandSelected ? null : brand.id,
                          groupId: null,
                        })
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation()
                          onSelect({
                            brandId: isBrandSelected ? null : brand.id,
                            groupId: null,
                          })
                        }
                      }}
                    >
                      {brand.name}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {brand.groups.reduce((s, g) => s + g.skuCount, 0)} SKU
                    </Badge>
                    <HealthBar dist={brand.healthRatio} />
                    <span className="ml-auto font-mono text-xs tabular-nums">
                      {KRW.format(brandTotalQty)}
                    </span>
                  </button>
                  {isOpen && brand.groups.length > 0 && (
                    <div className="bg-muted/20">
                      {brand.groups.map((g) => {
                        const isGroupSelected = selectedGroupId === g.id
                        return (
                          <button
                            type="button"
                            key={g.id}
                            onClick={() =>
                              onSelect({
                                brandId: brand.id,
                                groupId: isGroupSelected ? null : g.id,
                              })
                            }
                            className={cn(
                              'flex w-full items-center gap-2 px-4 py-2 pl-9 text-left text-sm transition-colors hover:bg-muted/40',
                              isGroupSelected && 'bg-primary/10 font-medium'
                            )}
                          >
                            <span className="truncate">{g.name}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {g.skuCount}
                            </Badge>
                            <HealthBar dist={g.healthRatio} />
                            <span className="ml-auto font-mono text-xs tabular-nums">
                              {KRW.format(g.totalQty)}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
