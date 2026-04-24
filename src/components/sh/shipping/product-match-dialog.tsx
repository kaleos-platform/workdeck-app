'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Layers, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { productDisplayName } from '@/lib/sh/product-display'

type ProductRow = {
  id: string
  name: string
  internalName?: string | null
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

type ListingEntry = {
  listingId: string
  searchName: string
  displayName: string
  itemCount: number
  channelName: string | null
  retailPrice: number | null
  composition: string // e.g. "블랙 L ×2 · 화이트 L ×1"
}

export type MatchResult =
  | {
      mode: 'option'
      optionId: string
      productName: string
      optionName: string
      savedAlias: boolean
    }
  | {
      mode: 'listing'
      listingId: string
      searchName: string
      displayName: string
      savedAlias: boolean
    }

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  orderId: string
  itemId: string
  rawName: string
  channelId?: string | null
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
  channelId,
  channelName,
  channelSet,
  onMatched,
}: Props) {
  const defaultTab = channelSet ? 'listing' : 'option'
  const [tab, setTab] = useState<'listing' | 'option'>(defaultTab)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [saveAlias, setSaveAlias] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [optionResults, setOptionResults] = useState<OptionEntry[]>([])
  const [listingResults, setListingResults] = useState<ListingEntry[]>([])
  const [optionLoading, setOptionLoading] = useState(false)
  const [listingLoading, setListingLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setSearch(rawName)
      setDebouncedSearch(rawName)
      setTab(channelSet ? 'listing' : 'option')
    }
  }, [open, rawName, channelSet])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // 옵션 검색 (탭 'option')
  useEffect(() => {
    if (!open || tab !== 'option') return
    const q = debouncedSearch.trim()
    setOptionLoading(true)
    const url = q
      ? `/api/sh/products?search=${encodeURIComponent(q)}&pageSize=20`
      : `/api/sh/products?pageSize=20`
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const rows: ProductRow[] = data?.data ?? []
        const flattened: OptionEntry[] = []
        for (const p of rows) {
          const productName = productDisplayName(p)
          for (const o of p.options ?? []) {
            flattened.push({
              optionId: o.id,
              optionName: o.name,
              productId: p.id,
              productName,
              sku: o.sku,
              brandName: p.brand?.name ?? null,
            })
          }
        }
        setOptionResults(flattened)
      })
      .catch(() => setOptionResults([]))
      .finally(() => setOptionLoading(false))
  }, [open, tab, debouncedSearch])

  // listing 검색 (탭 'listing') — 현재 채널에 한정
  useEffect(() => {
    if (!open || tab !== 'listing' || !channelId) return
    const q = debouncedSearch.trim()
    setListingLoading(true)
    const qs = new URLSearchParams({ channelId, pageSize: '20' })
    if (q) qs.set('search', q)
    fetch(`/api/sh/products/listings?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const rows: Array<{
          id: string
          searchName: string
          displayName: string
          itemCount: number
          retailPrice: number | null
          items: Array<{ optionName: string; productName: string; quantity: number }>
        }> = data?.data ?? []
        setListingResults(
          rows.map((l) => ({
            listingId: l.id,
            searchName: l.searchName,
            displayName: l.displayName,
            itemCount: l.itemCount,
            channelName: channelName ?? null,
            retailPrice: l.retailPrice,
            composition:
              (l.items ?? [])
                .slice(0, 3)
                .map((it) => `${it.optionName} ×${it.quantity}`)
                .join(' · ') + (l.items && l.items.length > 3 ? ' …' : ''),
          }))
        )
      })
      .catch(() => setListingResults([]))
      .finally(() => setListingLoading(false))
  }, [open, tab, debouncedSearch, channelId, channelName])

  async function pickOption(entry: OptionEntry) {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/sh/shipping/orders/${orderId}/items/${itemId}/match`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'option',
          optionId: entry.optionId,
          saveAlias: saveAlias && channelSet,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '매칭 실패')
      }
      const data = await res.json()
      toast.success(saveAlias && channelSet ? '매칭 완료 · 별칭으로 저장했습니다' : '매칭 완료')
      onMatched({
        mode: 'option',
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

  async function pickListing(entry: ListingEntry) {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/sh/shipping/orders/${orderId}/items/${itemId}/match`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'listing',
          listingId: entry.listingId,
          saveAlias: saveAlias && channelSet,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '매칭 실패')
      }
      const data = await res.json()
      toast.success(
        saveAlias && channelSet
          ? '판매채널 상품 매칭 완료 · 별칭으로 저장했습니다'
          : '판매채널 상품 매칭 완료'
      )
      onMatched({
        mode: 'listing',
        listingId: entry.listingId,
        searchName: entry.searchName,
        displayName: entry.displayName,
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
          <DialogTitle>상품 매칭</DialogTitle>
          <DialogDescription>
            <span className="block">
              원본 상품명: <span className="font-medium text-foreground">{rawName}</span>
            </span>
            {channelName ? <span className="mt-0.5 block text-xs">채널: {channelName}</span> : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="match-search">검색</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="match-search"
                className="pl-8"
                placeholder={
                  tab === 'listing' ? '판매채널 상품명 · 관리코드' : '관리 상품명 · SKU · 옵션'
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as 'listing' | 'option')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="listing" disabled={!channelSet}>
                <Layers className="mr-1 h-4 w-4" />
                판매채널 상품
              </TabsTrigger>
              <TabsTrigger value="option">개별 옵션</TabsTrigger>
            </TabsList>

            <TabsContent value="listing" className="mt-3">
              {!channelSet ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  주문에 판매채널이 지정돼 있지 않아 판매채널 상품으로 매칭할 수 없습니다
                </p>
              ) : (
                <div className="max-h-[45vh] space-y-1 overflow-y-auto rounded-md border p-1">
                  {listingLoading ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">검색 중...</p>
                  ) : listingResults.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      이 채널에 등록된 판매채널 상품이 없습니다
                    </p>
                  ) : (
                    listingResults.map((e) => (
                      <button
                        key={e.listingId}
                        type="button"
                        disabled={submitting}
                        onClick={() => pickListing(e)}
                        className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{e.searchName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {e.composition || `${e.itemCount}개 옵션 구성`}
                          </p>
                        </div>
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="option" className="mt-3">
              <div className="max-h-[45vh] space-y-1 overflow-y-auto rounded-md border p-1">
                {optionLoading ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">검색 중...</p>
                ) : optionResults.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    검색 결과가 없습니다
                  </p>
                ) : (
                  optionResults.map((e) => (
                    <button
                      key={e.optionId}
                      type="button"
                      disabled={submitting}
                      onClick={() => pickOption(e)}
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
            </TabsContent>
          </Tabs>

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
              주문에 판매 채널이 지정되어 있지 않아 별칭을 저장할 수 없습니다
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
