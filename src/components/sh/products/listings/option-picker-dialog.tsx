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
import { productDisplayName } from '@/lib/sh/product-display'

type ProductRow = {
  id: string
  name: string
  internalName?: string | null
  code: string | null
  brand?: { id: string; name: string } | null
  options: {
    id: string
    name: string
    sku: string | null
    retailPrice?: string | number | null
  }[]
}

export type PickedOption = {
  optionId: string
  optionName: string
  productId: string
  productName: string
  sku: string | null
  brandName: string | null
  retailPrice: number | null
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPick: (opt: PickedOption) => void
  excludeOptionIds?: string[]
  initialQuery?: string
}

export function OptionPickerDialog({
  open,
  onOpenChange,
  onPick,
  excludeOptionIds = [],
  initialQuery = '',
}: Props) {
  const [search, setSearch] = useState(initialQuery)
  const [debounced, setDebounced] = useState(initialQuery)
  const [results, setResults] = useState<PickedOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setSearch(initialQuery)
      setDebounced(initialQuery)
    }
  }, [open, initialQuery])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const qs = new URLSearchParams()
        qs.set('pageSize', '20')
        if (debounced.trim()) qs.set('search', debounced.trim())
        const res = await fetch(`/api/sh/products?${qs.toString()}`)
        if (!res.ok) throw new Error('검색 실패')
        const data: { data?: ProductRow[]; products?: ProductRow[] } = await res.json()
        if (cancelled) return
        const products = data.data ?? data.products ?? []
        const flat: PickedOption[] = []
        for (const p of products) {
          for (const o of p.options ?? []) {
            flat.push({
              optionId: o.id,
              optionName: o.name,
              productId: p.id,
              productName: productDisplayName(p),
              sku: o.sku,
              brandName: p.brand?.name ?? null,
              retailPrice: o.retailPrice != null ? Number(o.retailPrice) : null,
            })
          }
        }
        setResults(flat)
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
          <DialogTitle>옵션 선택</DialogTitle>
          <DialogDescription>
            상품명·관리코드로 검색해 묶음에 포함할 옵션을 선택하세요
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="option-picker-search">검색</Label>
            <div className="relative">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="option-picker-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="상품명 / 관리코드 / SKU"
                className="pl-9"
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
                      onClick={() => onPick(r)}
                      className="w-full px-4 py-3 text-left transition hover:bg-muted/60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{r.productName}</p>
                          <p className="text-sm text-muted-foreground">{r.optionName}</p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          {r.sku && <p>SKU {r.sku}</p>}
                          {r.brandName && <p>{r.brandName}</p>}
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
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
