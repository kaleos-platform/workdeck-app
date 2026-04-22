'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ProductRow = {
  id: string
  name: string
  code: string | null
  brand?: { id: string; name: string } | null
  options: { id: string; name: string; sku: string | null }[]
}

type OptionEntry = {
  optionId: string
  optionName: string
  productId: string
  productName: string
  sku: string | null
  brandName: string | null
}

export type MatchResult = {
  optionId: string
  productName: string
  optionName: string
  savedAlias: boolean
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  orderId: string
  itemId: string
  rawName: string
  channelName?: string | null
  channelSet: boolean
  onMatched: (result: MatchResult) => void
}

export function ProductMatchDialog({
  open,
  onOpenChange,
  orderId,
  itemId,
  rawName,
  channelName,
  channelSet,
  onMatched,
}: Props) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [results, setResults] = useState<OptionEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [saveAlias, setSaveAlias] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // 다이얼로그 열릴 때 raw name을 초기 검색어로 투입
  useEffect(() => {
    if (open) {
      setSearch(rawName)
      setDebouncedSearch(rawName)
    }
  }, [open, rawName])

  // debounce 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // 검색 수행
  useEffect(() => {
    if (!open) return
    const q = debouncedSearch.trim()
    setLoading(true)
    const url = q
      ? `/api/sh/products?search=${encodeURIComponent(q)}&pageSize=20`
      : `/api/sh/products?pageSize=20`
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const rows: ProductRow[] = data?.data ?? []
        const flattened: OptionEntry[] = []
        for (const p of rows) {
          for (const o of p.options ?? []) {
            flattened.push({
              optionId: o.id,
              optionName: o.name,
              productId: p.id,
              productName: p.name,
              sku: o.sku,
              brandName: p.brand?.name ?? null,
            })
          }
        }
        setResults(flattened)
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [open, debouncedSearch])

  async function handlePick(entry: OptionEntry) {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/sh/shipping/orders/${orderId}/items/${itemId}/match`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionId: entry.optionId, saveAlias: saveAlias && channelSet }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '매칭 실패')
      }
      const data = await res.json()
      toast.success(
        saveAlias && channelSet ? `매칭 완료 · 이 채널의 별칭으로 저장했습니다` : '매칭 완료'
      )
      onMatched({
        optionId: entry.optionId,
        productName: entry.productName,
        optionName: entry.optionName,
        savedAlias: !!data?.aliasSaved,
      })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '매칭 실패')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>카탈로그 옵션 매칭</DialogTitle>
          <DialogDescription>
            <span className="block">
              원본 상품명: <span className="font-medium text-foreground">{rawName}</span>
            </span>
            {channelName ? <span className="mt-0.5 block text-xs">채널: {channelName}</span> : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="match-search">상품/옵션 검색</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="match-search"
                className="pl-8"
                placeholder="상품명 또는 제품코드"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <div className="max-h-[45vh] space-y-1 overflow-y-auto rounded-md border p-1">
            {loading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">검색 중...</p>
            ) : results.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">검색 결과가 없습니다</p>
            ) : (
              results.map((e) => (
                <button
                  key={e.optionId}
                  type="button"
                  disabled={submitting}
                  onClick={() => handlePick(e)}
                  className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {e.productName}{' '}
                      <span className="text-muted-foreground">— {e.optionName}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {e.brandName ? `${e.brandName} · ` : ''}
                      {e.sku ? `SKU ${e.sku}` : '관리코드 없음'}
                    </p>
                  </div>
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={saveAlias}
              onCheckedChange={(v) => setSaveAlias(v === true)}
              disabled={!channelSet}
            />
            <span className={channelSet ? undefined : 'text-muted-foreground'}>
              이 채널의 별칭으로 저장 — 다음부터 자동 매칭
            </span>
          </label>
          {!channelSet && (
            <p className="text-xs text-muted-foreground">
              주문에 판매 채널이 지정되어 있지 않아 별칭을 저장할 수 없습니다.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            취소
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
