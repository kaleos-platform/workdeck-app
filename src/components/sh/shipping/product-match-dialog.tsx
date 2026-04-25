'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Layers, Pencil, Plus, Search, X } from 'lucide-react'
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
import { cn } from '@/lib/utils'

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
  | {
      mode: 'manual'
      fulfillmentCount: number
      totalQuantity: number
      fulfillments: Array<{
        optionId: string
        productName: string
        optionName: string
        quantity: number
      }>
    }

type ManualItem = {
  optionId: string
  optionName: string
  productName: string
  quantity: number
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  orderId: string
  itemId: string
  rawName: string
  // 주문 행의 수량 — 수동 입력 탭에서 '1주문당' × orderQty 미리보기용
  orderQty?: number
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
  orderQty = 1,
  channelId,
  channelName,
  channelSet,
  onMatched,
}: Props) {
  const defaultTab = channelSet ? 'listing' : 'option'
  const [tab, setTab] = useState<'listing' | 'option' | 'manual'>(defaultTab)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [saveAlias, setSaveAlias] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [optionResults, setOptionResults] = useState<OptionEntry[]>([])
  const [listingResults, setListingResults] = useState<ListingEntry[]>([])
  const [optionLoading, setOptionLoading] = useState(false)
  const [listingLoading, setListingLoading] = useState(false)
  const [manualItems, setManualItems] = useState<ManualItem[]>([])

  useEffect(() => {
    if (open) {
      setSearch('')
      setDebouncedSearch('')
      setTab(channelSet ? 'listing' : 'option')
      setManualItems([])
    }
  }, [open, channelSet])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // 옵션 검색 (탭 'option' · 'manual')
  useEffect(() => {
    if (!open || (tab !== 'option' && tab !== 'manual')) return
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

  function addManualOption(entry: OptionEntry) {
    setManualItems((prev) => {
      const existing = prev.findIndex((m) => m.optionId === entry.optionId)
      if (existing >= 0) {
        return prev.map((m, i) => (i === existing ? { ...m, quantity: m.quantity + 1 } : m))
      }
      return [
        ...prev,
        {
          optionId: entry.optionId,
          optionName: entry.optionName,
          productName: entry.productName,
          quantity: 1,
        },
      ]
    })
  }

  function updateManualQty(optionId: string, quantity: number) {
    setManualItems((prev) =>
      prev.map((m) => (m.optionId === optionId ? { ...m, quantity: Math.max(1, quantity) } : m))
    )
  }

  function removeManualOption(optionId: string) {
    setManualItems((prev) => prev.filter((m) => m.optionId !== optionId))
  }

  async function saveManual() {
    if (manualItems.length === 0) {
      toast.error('출고 옵션을 1개 이상 추가해 주세요')
      return
    }
    setSubmitting(true)
    try {
      // 입력된 수량은 "1주문당" 수량. 서버에서 orderItem.quantity를 곱해 총 출고 수량으로 저장됨.
      const res = await fetch(`/api/sh/shipping/orders/${orderId}/items/${itemId}/match`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'manual',
          fulfillments: manualItems.map((m) => ({ optionId: m.optionId, quantity: m.quantity })),
          // 다중 fulfillment alias 저장 (ChannelProductAliasFulfillment): 채널 지정 + saveAlias 체크 시
          saveAlias: saveAlias && channelSet,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '저장 실패')
      }
      const perSetTotal = manualItems.reduce((s, m) => s + m.quantity, 0)
      const totalQuantity = perSetTotal * orderQty
      const aliasSaved = saveAlias && channelSet
      toast.success(
        `수동 입력 완료 · 출고 옵션 ${manualItems.length}종 총 ${totalQuantity}개${aliasSaved ? ' · 별칭으로 저장' : ''}`
      )
      onMatched({
        mode: 'manual',
        fulfillmentCount: manualItems.length,
        totalQuantity,
        // UI 즉시 반영용 — 서버와 동일하게 orderQty 곱한 최종 수량으로 전달
        fulfillments: manualItems.map((m) => ({
          optionId: m.optionId,
          productName: m.productName,
          optionName: m.optionName,
          quantity: m.quantity * orderQty,
        })),
      })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
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

          <Tabs value={tab} onValueChange={(v) => setTab(v as 'listing' | 'option' | 'manual')}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="listing" disabled={!channelSet}>
                <Layers className="mr-1 h-4 w-4" />
                판매채널 상품
              </TabsTrigger>
              <TabsTrigger value="option">개별 옵션</TabsTrigger>
              <TabsTrigger value="manual">
                <Pencil className="mr-1 h-4 w-4" />
                수동 입력
              </TabsTrigger>
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

            <TabsContent value="manual" className="mt-3 space-y-3">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">옵션 검색</p>
                <div className="max-h-[25vh] space-y-1 overflow-y-auto rounded-md border p-1">
                  {optionLoading ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">검색 중...</p>
                  ) : optionResults.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      검색 결과가 없습니다
                    </p>
                  ) : (
                    optionResults.map((e) => {
                      const added = manualItems.some((m) => m.optionId === e.optionId)
                      return (
                        <button
                          key={e.optionId}
                          type="button"
                          disabled={submitting}
                          onClick={() => addManualOption(e)}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50',
                            added && 'bg-primary/5'
                          )}
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
                          {added ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                          ) : (
                            <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">출고 옵션</p>
                    <p className="text-[10px] leading-tight text-muted-foreground">
                      1 주문당 수량을 입력 — 주문 수량 {orderQty}개 × 입력값 = 총 출고
                    </p>
                  </div>
                  {manualItems.length > 0 && (
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {manualItems.length}종 · 총{' '}
                      {manualItems.reduce((s, m) => s + m.quantity, 0) * orderQty}개
                    </p>
                  )}
                </div>
                {manualItems.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    위에서 옵션을 검색하고 클릭해 추가하세요
                  </div>
                ) : (
                  <ul className="space-y-1 rounded-md border p-1">
                    {manualItems.map((m) => (
                      <li
                        key={m.optionId}
                        className="flex items-center gap-2 rounded-sm bg-primary/5 px-2 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{m.productName}</p>
                          <p className="truncate text-xs text-muted-foreground">{m.optionName}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <Input
                            type="number"
                            min={1}
                            value={m.quantity}
                            onChange={(e) =>
                              updateManualQty(m.optionId, Number(e.target.value) || 1)
                            }
                            className="h-8 w-14 [appearance:textfield] text-center text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            title="1 주문당 수량"
                          />
                          <span>장 × {orderQty}개 =</span>
                          <span className="font-medium text-foreground">
                            {m.quantity * orderQty}개
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => removeManualOption(m.optionId)}
                          disabled={submitting}
                          title="삭제"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Button
                type="button"
                onClick={saveManual}
                disabled={submitting || manualItems.length === 0}
                className="w-full"
              >
                {submitting ? '저장 중...' : '수동 매칭 저장'}
              </Button>
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
          {tab === 'manual' && channelSet && (
            <p className="text-xs text-muted-foreground">
              저장 시 동일한 원본 상품명이 다음 업로드에서 동일한 옵션 조합으로 자동 매칭됩니다
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
