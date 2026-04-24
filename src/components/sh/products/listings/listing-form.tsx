'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SELLER_HUB_LISTINGS_PATH, getSellerHubListingPath } from '@/lib/deck-routes'
import {
  computeDiscount,
  computeEffectiveStatus,
  computeListingAvailableStock,
  computeListingRetailBaseline,
  type EffectiveListingStatus,
} from '@/lib/sh/listing-calc'

import { OptionPickerDialog, type PickedOption } from './option-picker-dialog'
import { KeywordEditor } from './keyword-editor'
import { countChars, getChannelNameLimit } from './channel-name-limits'

const MAX_NAME_LENGTH = 200

type Channel = {
  id: string
  name: string
  kind: string
  isActive: boolean
}

type ItemDraft = {
  optionId: string
  optionName: string
  sku: string | null
  productId: string
  productName: string
  brandName: string | null
  quantity: number
  retailPrice: number | null
  optionStock: number
}

export type ListingFormInitial = {
  id: string
  channel: { id: string; name: string }
  internalCode: string | null
  searchName: string
  displayName: string
  keywords: string[]
  retailPrice: number | null
  status: 'ACTIVE' | 'SUSPENDED'
  memo: string | null
  items: ItemDraft[]
  availableStock: number
}

type Props = {
  mode: 'create' | 'edit'
  initial?: ListingFormInitial
  defaultChannelId?: string | null
}

export function ListingForm({ mode, initial, defaultChannelId }: Props) {
  const router = useRouter()
  const [channels, setChannels] = useState<Channel[]>([])
  const [channelId, setChannelId] = useState<string>(initial?.channel.id ?? defaultChannelId ?? '')
  const [searchName, setSearchName] = useState(initial?.searchName ?? '')
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '')
  const [internalCode, setInternalCode] = useState(initial?.internalCode ?? '')
  const [memo, setMemo] = useState(initial?.memo ?? '')
  const [retailPrice, setRetailPrice] = useState<string>(
    initial?.retailPrice != null ? String(initial.retailPrice) : ''
  )
  const [keywords, setKeywords] = useState<string[]>(initial?.keywords ?? [])
  const [status, setStatus] = useState<'ACTIVE' | 'SUSPENDED'>(initial?.status ?? 'ACTIVE')
  const [items, setItems] = useState<ItemDraft[]>(initial?.items ?? [])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // 채널 목록 로드
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/channels?isActive=true')
        if (!res.ok) throw new Error('채널 목록 조회 실패')
        const data: { channels: Channel[] } = await res.json()
        if (!cancelled) setChannels(data.channels ?? [])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '채널 조회 실패')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const currentChannel = channels.find((c) => c.id === channelId) ?? null
  const nameLimit = getChannelNameLimit(currentChannel?.name ?? initial?.channel.name ?? null)

  const baselinePrice = useMemo(
    () =>
      computeListingRetailBaseline(
        items.map((it) => ({ quantity: it.quantity, retailPrice: it.retailPrice }))
      ),
    [items]
  )
  const availableStock = useMemo(
    () =>
      computeListingAvailableStock(
        items.map((it) => ({ quantity: it.quantity, optionStock: it.optionStock }))
      ),
    [items]
  )
  const saleNumber = retailPrice.trim().length > 0 ? Number(retailPrice) : null
  const effective: EffectiveListingStatus = computeEffectiveStatus(status, availableStock)
  const discount = computeDiscount(baselinePrice, saleNumber)

  const keywordSuggestions = useMemo(() => {
    const set = new Set<string>()
    for (const it of items) {
      if (it.brandName) set.add(it.brandName)
      set.add(it.productName)
      for (const token of it.optionName.split(/\s+|\//)) {
        const t = token.trim()
        if (t.length >= 2 && t.length <= 20) set.add(t)
      }
    }
    return Array.from(set)
  }, [items])

  function addOption(picked: PickedOption) {
    if (items.some((it) => it.optionId === picked.optionId)) {
      toast.error('이미 추가된 옵션입니다')
      return
    }
    // 옵션의 정확한 재고·소매가는 저장 후 상세 페이지에서 확인.
    // 생성 중에는 프리뷰 값만 0으로 두고, 수량 편집만 지원.
    setItems((prev) => [
      ...prev,
      {
        optionId: picked.optionId,
        optionName: picked.optionName,
        sku: picked.sku,
        productId: picked.productId,
        productName: picked.productName,
        brandName: picked.brandName,
        quantity: 1,
        retailPrice: null,
        optionStock: 0,
      },
    ])
    setPickerOpen(false)
  }

  function updateItemQuantity(optionId: string, value: number) {
    setItems((prev) =>
      prev.map((it) => (it.optionId === optionId ? { ...it, quantity: Math.max(1, value) } : it))
    )
  }

  function removeItem(optionId: string) {
    setItems((prev) => prev.filter((it) => it.optionId !== optionId))
  }

  const formValid =
    channelId.trim().length > 0 &&
    searchName.trim().length > 0 &&
    displayName.trim().length > 0 &&
    items.length > 0

  async function handleSave() {
    if (!formValid) {
      toast.error('필수 항목을 입력해 주세요')
      return
    }
    setSaving(true)
    try {
      const payload = {
        channelId,
        searchName: searchName.trim(),
        displayName: displayName.trim(),
        internalCode: internalCode.trim() || undefined,
        memo: memo.trim() || undefined,
        retailPrice: retailPrice.trim() === '' ? undefined : Number(retailPrice),
        keywords,
        status,
        items: items.map((it, idx) => ({
          optionId: it.optionId,
          quantity: it.quantity,
          sortOrder: idx,
        })),
      }
      const url =
        mode === 'create' ? '/api/sh/products/listings' : `/api/sh/products/listings/${initial!.id}`
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success(
        mode === 'create' ? '판매채널 상품이 생성되었습니다' : '변경사항이 저장되었습니다'
      )
      const id = mode === 'create' ? data.listing.id : initial!.id
      router.push(getSellerHubListingPath(id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!initial) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/sh/products/listings/${initial.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제 실패')
      toast.success('삭제되었습니다')
      router.push(SELLER_HUB_LISTINGS_PATH)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
      setDeleteOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={SELLER_HUB_LISTINGS_PATH}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          목록으로
        </Link>
        <div className="flex items-center gap-2">
          {mode === 'edit' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              disabled={saving || deleting}
            >
              <Trash2 className="mr-1 h-4 w-4" /> 삭제
            </Button>
          )}
          <Button variant="outline" onClick={() => router.back()} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={!formValid || saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            저장
          </Button>
        </div>
      </div>

      {/* 기본 정보 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">기본 정보</CardTitle>
          <CardDescription>판매채널에 노출될 상품명과 관리 정보</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="listing-channel">판매채널 *</Label>
              {mode === 'edit' ? (
                <Input id="listing-channel" value={initial!.channel.name} disabled />
              ) : (
                <Select value={channelId} onValueChange={setChannelId}>
                  <SelectTrigger id="listing-channel">
                    <SelectValue placeholder="채널을 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="listing-code">관리 코드</Label>
              <Input
                id="listing-code"
                value={internalCode}
                onChange={(e) => setInternalCode(e.target.value)}
                placeholder="예: CP-MUD-2SET"
                maxLength={50}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="listing-search">상품명 (검색용) *</Label>
              <NameCounter value={searchName} limit={nameLimit.searchName} />
            </div>
            <Input
              id="listing-search"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              placeholder="판매채널 리스팅에 노출되는 상품명"
              maxLength={MAX_NAME_LENGTH}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="listing-display">상품명 (노출용) *</Label>
              <NameCounter value={displayName} limit={nameLimit.displayName} />
            </div>
            <Input
              id="listing-display"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="상세 페이지에 표시되는 상품명"
              maxLength={MAX_NAME_LENGTH}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="listing-memo">메모</Label>
            <Textarea
              id="listing-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="내부 참고용 메모"
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* 구성 옵션 */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-lg">구성 옵션</CardTitle>
            <CardDescription>묶음에 포함될 상품 옵션과 수량. 최소 1개, 최대 50개</CardDescription>
          </div>
          <Button onClick={() => setPickerOpen(true)} size="sm">
            <Plus className="mr-1 h-4 w-4" />
            옵션 추가
          </Button>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
              구성 옵션을 1개 이상 추가해 주세요
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((it) => (
                <li
                  key={it.optionId}
                  className="flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {it.productName}
                      <span className="text-muted-foreground"> · {it.optionName}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      재고 {it.optionStock.toLocaleString('ko-KR')}
                      {it.sku ? ` · SKU ${it.sku}` : ''}
                      {it.retailPrice != null
                        ? ` · 소비자가 ${it.retailPrice.toLocaleString('ko-KR')}원`
                        : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">수량</span>
                    <Input
                      type="number"
                      min={1}
                      max={999}
                      value={it.quantity}
                      onChange={(e) => updateItemQuantity(it.optionId, Number(e.target.value || 1))}
                      className="h-9 w-20"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(it.optionId)}
                    aria-label="옵션 제거"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {items.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">자동 계산:</span>
              <span>
                소비자가{' '}
                {baselinePrice != null ? `${baselinePrice.toLocaleString('ko-KR')}원` : '-'}
              </span>
              <span>
                가용재고{' '}
                <span className="font-medium">{availableStock.toLocaleString('ko-KR')}</span>
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 가격 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">가격</CardTitle>
          <CardDescription>
            판매가격을 입력하면 소비자가 대비 할인이 자동 계산됩니다
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="listing-price">판매가격 (원)</Label>
              <Input
                id="listing-price"
                type="number"
                min={0}
                value={retailPrice}
                onChange={(e) => setRetailPrice(e.target.value)}
                placeholder="예: 35000"
              />
            </div>
            <div className="space-y-1.5">
              <Label>할인</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm">
                {discount.diff != null && discount.percent != null
                  ? `-${Math.abs(discount.diff).toLocaleString('ko-KR')}원 (-${discount.percent.toFixed(1)}%)`
                  : '-'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 키워드 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">키워드</CardTitle>
          <CardDescription>검색 노출을 위한 키워드. 최대 30개</CardDescription>
        </CardHeader>
        <CardContent>
          <KeywordEditor value={keywords} onChange={setKeywords} suggestions={keywordSuggestions} />
        </CardContent>
      </Card>

      {/* 판매 상태 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">판매 상태</CardTitle>
          <CardDescription>사용자가 설정. 재고 0이면 자동으로 품절로 표시됩니다</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Select value={status} onValueChange={(v) => setStatus(v as 'ACTIVE' | 'SUSPENDED')}>
            <SelectTrigger className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">판매중</SelectItem>
              <SelectItem value="SUSPENDED">판매중지</SelectItem>
            </SelectContent>
          </Select>
          {effective === 'SOLD_OUT' && (
            <p className="text-sm text-amber-600">
              ⚠ 가용재고가 0입니다 — 채널에는 자동으로 &lsquo;품절&rsquo;로 표시됩니다
            </p>
          )}
        </CardContent>
      </Card>

      <OptionPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={addOption}
        excludeOptionIds={items.map((it) => it.optionId)}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>판매채널 상품 삭제</DialogTitle>
            <DialogDescription>
              이 판매채널 상품을 삭제합니다. 이미 매칭된 주문은 영향을 받지 않지만 향후 자동
              매칭에서 제외됩니다. 계속하시겠습니까?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function NameCounter({ value, limit }: { value: string; limit?: number }) {
  const n = countChars(value)
  const overflow = limit != null && n > limit
  const color = overflow ? 'text-destructive' : 'text-muted-foreground'
  return (
    <span className={`text-xs ${color}`}>
      {n}
      {limit != null ? ` / ${limit}(가이드)` : ` / ${MAX_NAME_LENGTH}`}
    </span>
  )
}
