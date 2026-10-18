'use client'

// 같은 상품을 쓰는 판매채널들의 검색 키워드를 골라 현재 편집기에 붙인다.
//
// 데이터는 상품 편집 카드와 같은 `/api/sh/products/[productId]/keyword-cards` 를 쓴다 —
// 혼합 세트 리스팅은 거기서 이미 빠진다. 구성에 상품이 여럿이면 상품별로 따로 불러와 묶어 보여준다.
//
// 거르는 건 하드 상한(MAX_KEYWORDS)과 중복뿐이다. 다른 채널 규칙으로 저장된 키워드라 현재 채널 기준
// 위반이 나올 수 있지만, 판정은 붙인 뒤 KeywordEditor 의 경고·정리에 맡긴다(검증 이중화 방지).

import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { normalizeKeyword } from '@/lib/sh/keyword-normalize'
import { cn } from '@/lib/utils'

import { MAX_KEYWORDS } from './keyword-editor'

type KeywordCard = {
  kind: 'channelProduct' | 'listing'
  id: string
  channelId: string
  channelName: string
  searchName: string
  keywords: string[]
}

type ProductCards = { productId: string; productName: string; cards: KeywordCard[] }

type Props = {
  /** 구성 옵션에 들어간 상품 id (중복 없이) */
  productIds: string[]
  currentChannelId: string | null
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

export function ChannelKeywordImportDialog({
  productIds,
  currentChannelId,
  value,
  onChange,
  disabled,
}: Props) {
  // 어떤 구성(productKey)에 대한 결과인지 함께 둔다 — 구성이 바뀌면 응답 도착 전까지 로딩으로 본다.
  const [fetched, setFetched] = useState<{ key: string; groups: ProductCards[] }>({
    key: '',
    groups: [],
  })
  const [open, setOpen] = useState(false)
  // 정규화 키 → 처음 고른 원문. 같은 키워드가 여러 채널에 있어도 한 번만 센다.
  const [picked, setPicked] = useState<Map<string, string>>(new Map())

  // 버튼 활성 여부를 열기 전에 알아야 하므로 구성이 바뀔 때마다 미리 불러온다. 실패는 조용히 무시(부가 기능).
  const productKey = productIds.join(',')
  useEffect(() => {
    if (!productKey) return
    let cancelled = false
    Promise.all(
      productKey.split(',').map(async (productId): Promise<ProductCards | null> => {
        const res = await fetch(`/api/sh/products/${productId}/keyword-cards`)
        if (!res.ok) return null
        const data: { productName?: string; cards?: KeywordCard[] } = await res.json()
        const cards = (data.cards ?? []).filter((c) => c.keywords.length > 0)
        return cards.length > 0 ? { productId, productName: data.productName ?? '', cards } : null
      })
    )
      .then((rs) => rs.filter((r): r is ProductCards => r !== null))
      .catch(() => [])
      .then((groups) => {
        if (!cancelled) setFetched({ key: productKey, groups })
      })
    return () => {
      cancelled = true
    }
  }, [productKey])

  const loading = Boolean(productKey) && fetched.key !== productKey
  const groups = productKey && !loading ? fetched.groups : []

  const existing = useMemo(() => new Set(value.map(normalizeKeyword)), [value])
  const remaining = Math.max(0, MAX_KEYWORDS - value.length)
  const full = picked.size >= remaining

  function toggle(kw: string) {
    const key = normalizeKeyword(kw)
    if (!key || existing.has(key)) return
    setPicked((prev) => {
      const next = new Map(prev)
      if (next.has(key)) next.delete(key)
      else if (next.size < remaining) next.set(key, kw)
      return next
    })
  }

  // 카드 안의 고를 수 있는 키워드를 남은 자리만큼 앞에서부터 담는다. 이미 다 골랐으면 해제한다.
  function toggleAll(keywords: string[]) {
    const candidates = keywords.filter((kw) => {
      const key = normalizeKeyword(kw)
      return key && !existing.has(key)
    })
    setPicked((prev) => {
      const next = new Map(prev)
      if (candidates.every((kw) => next.has(normalizeKeyword(kw)))) {
        for (const kw of candidates) next.delete(normalizeKeyword(kw))
        return next
      }
      for (const kw of candidates) {
        if (next.size >= remaining) break
        const key = normalizeKeyword(kw)
        if (!next.has(key)) next.set(key, kw)
      }
      return next
    })
  }

  function handleAdd() {
    onChange([...value, ...picked.values()])
    setOpen(false)
  }

  function handleOpenChange(next: boolean) {
    if (next) setPicked(new Map())
    setOpen(next)
  }

  const empty = groups.length === 0
  const disabledReason =
    productIds.length === 0
      ? '구성 옵션을 먼저 선택하세요'
      : loading
        ? null
        : empty
          ? '이 상품을 쓰는 판매채널에 등록된 키워드가 없습니다'
          : null

  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* 비활성 버튼은 포인터 이벤트가 없어 툴팁이 안 뜬다 — span 으로 감싼다. */}
            <span tabIndex={disabledReason ? 0 : -1}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={disabled || loading || Boolean(disabledReason)}
                onClick={() => handleOpenChange(true)}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-4 w-4" aria-hidden="true" />
                )}
                판매채널 키워드 불러오기
              </Button>
            </span>
          </TooltipTrigger>
          {disabledReason && <TooltipContent>{disabledReason}</TooltipContent>}
        </Tooltip>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>판매채널 키워드 불러오기</DialogTitle>
            <DialogDescription>
              이 상품을 쓰는 판매채널의 키워드를 골라 추가합니다. 남은 자리{' '}
              <span className="font-medium text-foreground">{remaining - picked.size}개</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {groups.map((g) => (
              <section key={g.productId} className="space-y-2">
                {groups.length > 1 && <h3 className="text-sm font-semibold">{g.productName}</h3>}
                {g.cards.map((card) => (
                  <div key={`${card.kind}:${card.id}`} className="space-y-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium">
                          {card.channelName}
                          {card.channelId === currentChannelId && (
                            <Badge variant="secondary">현재 채널</Badge>
                          )}
                          <span className="text-xs font-normal text-muted-foreground">
                            {card.keywords.length}개
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{card.searchName}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleAll(card.keywords)}
                      >
                        전체 선택
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {card.keywords.map((kw) => {
                        const key = normalizeKeyword(kw)
                        const added = existing.has(key)
                        const checked = added || picked.has(key)
                        const blocked = added || (!checked && full)
                        return (
                          <label
                            key={kw}
                            className={cn(
                              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                              checked && !added && 'border-primary bg-primary/5',
                              blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={blocked}
                              onCheckedChange={() => toggle(kw)}
                            />
                            {kw}
                            {added && <span className="text-muted-foreground">(등록됨)</span>}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="button" disabled={picked.size === 0} onClick={handleAdd}>
              {picked.size}개 추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
