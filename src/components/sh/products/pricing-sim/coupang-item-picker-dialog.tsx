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
import { useTokenSearch } from '@/components/sh/products/listings/use-token-search'

type CandidateItem = {
  id: string
  itemName: string | null
  sellerProductId: string
  rgVendorItemId: string | null
  mpVendorItemId: string | null
  barcode: string | null
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** 연결 대상 판매채널 상품 */
  listingId: string
  listingName: string
  /** 연결 완료 후 (미리보기 재조회용) */
  onLinked: () => void
}

/**
 * 쿠팡 옵션 피커 — 지연 매핑(listingId 없는 CoupangProductItem) 후보에서 골라
 * /api/sh/coupang-price/link 로 리스팅과 연결한다.
 * 검색/칩/완화 로직은 option-picker-dialog.tsx 와 공유하는 use-token-search 훅을 쓴다.
 */
export function CoupangItemPickerDialog({
  open,
  onOpenChange,
  listingId,
  listingName,
  onLinked,
}: Props) {
  const {
    keywordTokens,
    search,
    debounced,
    relaxedNote,
    activeTokens,
    setSearch,
    toggleKeywordToken,
    reportResultCount,
  } = useTokenSearch({ open, keywordSource: listingName })

  const [items, setItems] = useState<CandidateItem[]>([])
  const [loading, setLoading] = useState(false)
  const [linkingId, setLinkingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const qs = new URLSearchParams()
        if (debounced.trim()) qs.set('search', debounced.trim())
        const res = await fetch(`/api/sh/coupang-price/items?${qs.toString()}`)
        if (!res.ok) throw new Error('검색 실패')
        const data: { items: CandidateItem[] } = await res.json()
        if (cancelled) return
        setItems(data.items)
        reportResultCount(data.items.length)
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
  }, [open, debounced, reportResultCount])

  async function handlePick(item: CandidateItem) {
    setLinkingId(item.id)
    try {
      const res = await fetch('/api/sh/coupang-price/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, coupangProductItemId: item.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? '연결 실패')
      toast.success('쿠팡 옵션을 연결했습니다')
      onLinked()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '연결 실패')
    } finally {
      setLinkingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg">
        <DialogHeader>
          <DialogTitle>쿠팡 옵션 연결</DialogTitle>
          <DialogDescription>
            「{listingName}」에 연결할 쿠팡 옵션을 선택하세요. 아직 어떤 판매채널 상품에도 연결되지
            않은 옵션만 표시됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {keywordTokens.length > 0 && (
            <div className="space-y-1">
              <Label>키워드</Label>
              <div className="flex flex-wrap gap-1.5">
                {keywordTokens.map((token) => {
                  const selected = activeTokens.has(token.toLowerCase())
                  return (
                    <Button
                      key={token}
                      type="button"
                      size="sm"
                      variant={selected ? 'default' : 'outline'}
                      className="h-7 px-2 text-xs"
                      onClick={() => toggleKeywordToken(token)}
                    >
                      {token}
                    </Button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="coupang-item-search">검색</Label>
            <div className="relative">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="coupang-item-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="쿠팡 상품명"
                className="pl-9"
              />
            </div>
            {relaxedNote && (
              <p className="text-xs text-amber-700">
                검색 결과가 없어 검색어를 완화했습니다: {relaxedNote}
              </p>
            )}
          </div>

          <div className="max-h-[50vh] overflow-y-auto rounded-md border">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">검색 중...</div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                연결 가능한 쿠팡 옵션이 없습니다
              </div>
            ) : (
              <ul className="divide-y">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={linkingId != null}
                      onClick={() => handlePick(item)}
                      className="w-full px-4 py-3 text-left transition hover:bg-muted/60 disabled:opacity-50"
                    >
                      <p className="font-medium">{item.itemName ?? '(상품명 없음)'}</p>
                      <p className="text-xs text-muted-foreground">
                        판매자상품 {item.sellerProductId}
                        {item.rgVendorItemId && ` · RG ${item.rgVendorItemId}`}
                        {item.mpVendorItemId && ` · MP ${item.mpVendorItemId}`}
                      </p>
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
