'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronDown, X } from 'lucide-react'
import {
  MAX_OPTION_SERIES,
  type OptionCatalogProduct,
  type OptionSelection,
} from '@/lib/sh/sales-analytics'

type Props = {
  catalog: OptionCatalogProduct[]
  selection: OptionSelection
  onChange: (next: OptionSelection) => void
  /** 현재 해석된 시리즈(선) 수 — 8선 제한 안내용 */
  seriesCount: number
}

/**
 * 상품→옵션 계층 다중선택 필터. 미선택=전체.
 * 상품 멀티셀렉트(먼저) → 선택 상품이 있으면 옵션 멀티셀렉트 활성(선택 상품들의 옵션만).
 * 최대 MAX_OPTION_SERIES 선까지. 그래프·표 공통 적용(상위 page 가 selection 보유).
 */
export function OptionFilter({ catalog, selection, onChange, seriesCount }: Props) {
  const { productIds, optionIds } = selection
  const productSet = useMemo(() => new Set(productIds), [productIds])
  const optionSet = useMemo(() => new Set(optionIds), [optionIds])

  // 옵션 필터 목록 = 선택 상품들의 옵션 (상품 미선택 시 비활성)
  const optionChoices = useMemo(
    () => catalog.filter((p) => productSet.has(p.productId)),
    [catalog, productSet]
  )

  const atSeriesCap = seriesCount >= MAX_OPTION_SERIES

  function toggleProduct(productId: string) {
    const next = new Set(productSet)
    if (next.has(productId)) {
      next.delete(productId)
      // 상품 해제 시 그 상품 옵션 선택도 제거
      const removed = catalog.find((p) => p.productId === productId)
      const optNext = new Set(optionSet)
      removed?.options.forEach((o) => optNext.delete(o.optionId))
      onChange({ productIds: [...next], optionIds: [...optNext] })
      return
    }
    next.add(productId)
    onChange({ productIds: [...next], optionIds: [...optionSet] })
  }

  function toggleOption(optionId: string) {
    const next = new Set(optionSet)
    if (next.has(optionId)) next.delete(optionId)
    else next.add(optionId)
    onChange({ productIds: [...productSet], optionIds: [...next] })
  }

  function clearAll() {
    onChange({ productIds: [], optionIds: [] })
  }

  const productTriggerLabel = productIds.length === 0 ? '전체 상품' : `상품 ${productIds.length}개`
  const optionTriggerLabel = optionIds.length === 0 ? '옵션 전체' : `옵션 ${optionIds.length}개`

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">필터</span>

      {/* 상품 멀티셀렉트 */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            {productTriggerLabel}
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div className="max-h-72 overflow-y-auto p-2">
            {catalog.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                기간 내 판매 데이터 없음
              </p>
            ) : (
              catalog.map((p) => (
                <label
                  key={p.productId}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
                >
                  <Checkbox
                    checked={productSet.has(p.productId)}
                    onCheckedChange={() => toggleProduct(p.productId)}
                  />
                  <span className="flex-1 truncate" title={p.productName}>
                    {p.productName}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {p.qty.toLocaleString('ko-KR')}
                  </span>
                </label>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* 옵션 멀티셀렉트 (상품 선택 시 활성) */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={optionChoices.length === 0}
          >
            {optionTriggerLabel}
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <div className="max-h-80 overflow-y-auto p-2">
            {optionChoices.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                먼저 상품을 선택하세요
              </p>
            ) : (
              optionChoices.map((p) => (
                <div key={p.productId} className="mb-1">
                  <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                    {p.productName}
                  </p>
                  {p.options.map((o) => {
                    const checked = optionSet.has(o.optionId)
                    const blocked = !checked && atSeriesCap
                    return (
                      <label
                        key={o.optionId}
                        className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
                          blocked
                            ? 'cursor-not-allowed opacity-40'
                            : 'cursor-pointer hover:bg-muted/50'
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={blocked}
                          onCheckedChange={() => !blocked && toggleOption(o.optionId)}
                        />
                        <span className="flex-1 truncate" title={o.optionName}>
                          {o.optionName}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {o.qty.toLocaleString('ko-KR')}
                        </span>
                      </label>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* 선택 요약 + 초기화 */}
      {(productIds.length > 0 || optionIds.length > 0) && (
        <>
          <Badge variant="secondary" className="gap-1">
            {seriesCount}/{MAX_OPTION_SERIES}선
          </Badge>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={clearAll}>
            <X className="h-3.5 w-3.5" />
            초기화
          </Button>
        </>
      )}
      {atSeriesCap && (
        <span className="text-xs text-amber-600 dark:text-amber-400">
          최대 {MAX_OPTION_SERIES}선까지 표시됩니다
        </span>
      )}
    </div>
  )
}
