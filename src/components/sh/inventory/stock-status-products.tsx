'use client'

import { useMemo } from 'react'
import { Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { StockProductSummary } from './stock-status.types'

type Props = {
  products: StockProductSummary[]
  loading?: boolean
  onSelectProduct: (productName: string) => void
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

// 용어 설명 툴팁 아이콘
function TermTooltip({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="ml-0.5 inline-block h-3 w-3 cursor-help align-middle text-muted-foreground/60" />
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function StockStatusProducts({ products, loading, onSelectProduct }: Props) {
  const sorted = useMemo(() => sortProducts(products), [products])

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-sm">상품별 재고 요약</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">상품 데이터가 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted/40">
                <tr className="border-b">
                  <th className="px-4 py-2 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    상품명
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    결품
                    <TermTooltip text="재고 0인 옵션 수" />
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    부족
                    <TermTooltip text="최근 30일 출고량보다 재고가 적은 옵션 수" />
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    과잉
                    <TermTooltip text="최근 90일 출고량보다 재고가 많은 옵션 수" />
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    정상
                    <TermTooltip text="결품·부족·과잉이 아닌 옵션 수" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr
                    key={p.productId}
                    className="cursor-pointer border-b transition-colors hover:bg-muted/30"
                    onClick={() => onSelectProduct(p.productName)}
                  >
                    <td className="px-4 py-2.5">
                      <span className="text-sm font-medium">{p.productName}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <OptionCountBadge count={p.outOptionCount} variant="out" />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <OptionCountBadge count={p.lowOptionCount} variant="low" />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <OptionCountBadge count={p.overOptionCount} variant="over" />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <OptionCountBadge count={p.okOptionCount} variant="ok" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
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
