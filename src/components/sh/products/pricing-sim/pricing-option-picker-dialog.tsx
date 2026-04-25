'use client'

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
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
  const visible = results.filter((r) => !excluded.has(r.optionId))

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
            ) : visible.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {debounced ? '검색 결과가 없습니다' : '검색어를 입력하세요'}
              </div>
            ) : (
              <ul className="divide-y">
                {visible.map((r) => (
                  <li key={r.optionId}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(r)
                        // dialog를 닫지 않아 연속 추가 가능
                      }}
                      className="w-full px-4 py-3 text-left transition hover:bg-muted/60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.productName}</p>
                          <p className="truncate text-sm text-muted-foreground">{r.optionName}</p>
                          {r.brandName && (
                            <span className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              {r.brandName}
                            </span>
                          )}
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          {r.sku && <p>SKU {r.sku}</p>}
                          {r.costPrice != null && (
                            <p className="text-foreground">원가 {r.costPrice.toLocaleString()}원</p>
                          )}
                          <p>재고 {r.totalStock.toLocaleString()}</p>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
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
