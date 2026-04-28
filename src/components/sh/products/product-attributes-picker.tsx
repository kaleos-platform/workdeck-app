'use client'

import { useEffect, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { OptionAttribute } from './product-option-attributes-editor'

type ProductListItem = {
  id: string
  name: string
  internalName: string | null
  code: string | null
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (attributes: OptionAttribute[]) => void
  /** 자기 자신 제외 (편집 중인 상품) */
  excludeProductId?: string
}

type RawValue = { value?: unknown; code?: unknown }
type RawAttr = { name?: unknown; values?: unknown }

function normalizeOptionAttributes(raw: unknown): OptionAttribute[] {
  if (!Array.isArray(raw)) return []
  const out: OptionAttribute[] = []
  for (const a of raw as RawAttr[]) {
    if (!a || typeof a.name !== 'string' || !Array.isArray(a.values)) continue
    const name = a.name.trim()
    if (!name) continue
    const values: OptionAttribute['values'] = []
    for (const v of a.values as RawValue[]) {
      if (!v || typeof v.value !== 'string') continue
      const value = v.value.trim()
      if (!value) continue
      values.push({ value, code: typeof v.code === 'string' ? v.code : '' })
    }
    if (values.length > 0) out.push({ name, values })
  }
  return out
}

export function ProductAttributesPicker({ open, onOpenChange, onPick, excludeProductId }: Props) {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<ProductListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [pickingId, setPickingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ pageSize: '50' })
        if (search.trim()) params.set('search', search.trim())
        const res = await fetch(`/api/sh/products?${params.toString()}`, {
          signal: ctrl.signal,
        })
        if (!res.ok) throw new Error('상품 조회 실패')
        const data = await res.json()
        const list = ((data?.data ?? []) as ProductListItem[]).map((p) => ({
          id: p.id,
          name: p.name,
          internalName: p.internalName ?? null,
          code: p.code ?? null,
        }))
        setItems(excludeProductId ? list.filter((p) => p.id !== excludeProductId) : list)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          toast.error(err instanceof Error ? err.message : '상품 조회 실패')
        }
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => {
      ctrl.abort()
      clearTimeout(timer)
    }
  }, [open, search, excludeProductId])

  // 다이얼로그 닫힐 때 검색어 초기화
  useEffect(() => {
    if (!open) {
      setSearch('')
      setItems([])
      setPickingId(null)
    }
  }, [open])

  async function handlePick(productId: string) {
    setPickingId(productId)
    try {
      const res = await fetch(`/api/sh/products/${productId}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '상품 정보 조회 실패')
      const parsed = normalizeOptionAttributes(data?.product?.optionAttributes)
      if (parsed.length === 0) {
        toast.error('이 상품에는 저장된 옵션 속성이 없습니다')
        return
      }
      onPick(parsed)
      onOpenChange(false)
      toast.success(`옵션 속성 ${parsed.length}개를 불러왔습니다`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '상품 정보 조회 실패')
    } finally {
      setPickingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>다른 상품에서 옵션 속성 불러오기</DialogTitle>
          <DialogDescription>
            상품을 선택하면 해당 상품의 옵션 속성(이름·값·코드)을 현재 편집 중인 상품에 복사합니다.
            기존 속성은 덮어쓰여집니다.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="상품명·코드 검색"
            className="pl-8"
            autoFocus
          />
        </div>

        <div className="max-h-[40vh] overflow-y-auto rounded-md border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              불러오는 중...
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {search.trim() ? '검색 결과가 없습니다' : '저장된 상품이 없습니다'}
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((p) => {
                const isPicking = pickingId === p.id
                const primary = p.internalName?.trim() || p.name
                const secondary = p.internalName?.trim() ? p.name : null
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={pickingId !== null}
                      onClick={() => handlePick(p.id)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 disabled:opacity-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{primary}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[secondary, p.code].filter(Boolean).join(' · ') || ' '}
                        </p>
                      </div>
                      {isPicking && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
