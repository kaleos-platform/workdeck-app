'use client'

import { useEffect, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// /api/sh/pricing-options 응답 형태
export type PricingOption = {
  optionId: string
  optionName: string
  sku: string | null
  productId: string
  productName: string
  brandName: string | null
  costPrice: number | null
  retailPrice: number | null
  totalStock: number
  msrp: number | null
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPick: (opt: PricingOption) => void
  excludeOptionIds?: string[]
}

export function PricingOptionPickerDialog({
  open,
  onOpenChange,
  onPick,
  excludeOptionIds = [],
}: Props) {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [results, setResults] = useState<PricingOption[]>([])
  const [loading, setLoading] = useState(false)

  // dialog 열릴 때 초기화
  useEffect(() => {
    if (open) {
      setSearch('')
      setDebounced('')
    }
  }, [open])

  // 디바운스
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // 검색
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const qs = new URLSearchParams()
        qs.set('pageSize', '30')
        if (debounced.trim()) qs.set('search', debounced.trim())
        const res = await fetch(`/api/sh/pricing-options?${qs.toString()}`)
        if (!res.ok) throw new Error('검색 실패')
        const data: { data: PricingOption[] } = await res.json()
        if (!cancelled) setResults(data.data ?? [])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '검색 실패')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, debounced])

  const excluded = new Set(excludeOptionIds)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl">
        <DialogHeader>
          <DialogTitle>옵션 추가</DialogTitle>
          <DialogDescription>
            상품명 · SKU · 브랜드로 검색해 시뮬레이션에 추가할 옵션을 선택하세요.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pricing-option-search">검색</Label>
            <div className="relative">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="pricing-option-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="상품명 / SKU / 브랜드"
                className="pl-9"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-[50vh] overflow-y-auto rounded-md border">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">검색 중...</div>
            ) : results.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {debounced ? '검색 결과가 없습니다' : '검색어를 입력하거나 잠시 기다려주세요'}
              </div>
            ) : (
              <ul className="divide-y">
                {results.map((r) => {
                  const isAdded = excluded.has(r.optionId)
                  return (
                    <li key={r.optionId}>
                      <button
                        type="button"
                        disabled={isAdded}
                        onClick={() => {
                          onPick(r)
                          toast.success(`${r.optionName} 추가됨`, { duration: 1500 })
                          // dialog를 닫지 않아 연속 추가 가능
                        }}
                        className={cn(
                          'w-full px-4 py-3 text-left transition',
                          isAdded
                            ? 'cursor-not-allowed bg-muted/30 opacity-60'
                            : 'hover:bg-muted/60'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="truncate font-medium">{r.productName}</p>
                              {isAdded && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                                  <Check className="h-3 w-3" />
                                  추가됨
                                </span>
                              )}
                            </div>
                            <p className="truncate text-sm text-muted-foreground">{r.optionName}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {r.brandName && (
                                <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                  {r.brandName}
                                </span>
                              )}
                              {r.sku && (
                                <span className="text-[11px] text-muted-foreground">
                                  SKU {r.sku}
                                </span>
                              )}
                              <span className="text-[11px] text-muted-foreground">
                                재고 {r.totalStock.toLocaleString()}
                              </span>
                            </div>
                          </div>
                          {/* 가격 정보 — 의사결정의 핵심 */}
                          <div className="shrink-0 space-y-0.5 rounded-md border bg-muted/30 px-2.5 py-1.5 text-right text-xs">
                            <div className="flex items-baseline justify-end gap-1.5">
                              <span className="text-[10px] text-muted-foreground">소매가</span>
                              <span
                                className={cn(
                                  'font-semibold tabular-nums',
                                  r.retailPrice != null
                                    ? 'text-foreground'
                                    : 'text-muted-foreground/60'
                                )}
                              >
                                {r.retailPrice != null
                                  ? `${r.retailPrice.toLocaleString()}원`
                                  : '—'}
                              </span>
                            </div>
                            <div className="flex items-baseline justify-end gap-1.5">
                              <span className="text-[10px] text-muted-foreground">원가</span>
                              <span
                                className={cn(
                                  'tabular-nums',
                                  r.costPrice != null ? 'text-foreground' : 'text-amber-600'
                                )}
                              >
                                {r.costPrice != null
                                  ? `${r.costPrice.toLocaleString()}원`
                                  : '직접 입력'}
                              </span>
                            </div>
                            {r.msrp != null && (
                              <div className="flex items-baseline justify-end gap-1.5">
                                <span className="text-[10px] text-muted-foreground">권장가</span>
                                <span className="text-muted-foreground tabular-nums">
                                  {r.msrp.toLocaleString()}원
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            완료
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
