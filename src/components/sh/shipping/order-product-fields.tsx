'use client'

import { useEffect, useState } from 'react'
import { Plus, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export type MatchedOption = {
  optionId: string
  productName: string
  optionName: string
}

export type OrderFulfillment = {
  optionId: string
  productName: string
  optionName: string
  quantity: number
}

export type OrderProduct = {
  name: string
  quantity: number
  // 매칭된 카탈로그 옵션 — 배송 파일 생성 시 상품명 소스로 사용
  optionId?: string | null
  listingId?: string | null
  matched?: MatchedOption | null
  // 저장된 DB 아이템 id — tempId 접두사가 없는 주문일 때만 존재 (매칭 API 호출용)
  itemId?: string | null
  // 실제 출고 옵션·수량 (listing 매칭 팬아웃 또는 수동 입력)
  fulfillments?: OrderFulfillment[] | null
}

const trimStart = (v: string) => v.replace(/^\s+/, '')

/**
 * 수량 입력 — 로컬 문자열 상태로 자유 편집 허용.
 * Blur 또는 Enter 시 검증(>= 1 정수)하고 부모로 최종값 전달.
 */
function QtyInput({
  value,
  onCommit,
  className,
}: {
  value: number
  onCommit: (n: number) => void
  className?: string
}) {
  const [local, setLocal] = useState(String(value))

  useEffect(() => {
    setLocal(String(value))
  }, [value])

  function commit() {
    const digits = local.replace(/[^0-9]/g, '')
    const n = digits === '' ? NaN : Number(digits)
    const valid = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
    setLocal(String(valid))
    if (valid !== value) onCommit(valid)
  }

  return (
    <Input
      type="text"
      inputMode="numeric"
      value={local}
      onChange={(e) => setLocal(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className={cn('h-7 w-14 shrink-0 text-center text-xs', className)}
    />
  )
}

/**
 * 트리 형식 fulfillment 표시:
 *   ㄴ productName optionName / N개 (perSet장 × orderQty개)
 *
 * - 단일 옵션 매칭(fulfillments 없음, optionId만): matched 기반 가상 엔트리 1개
 * - listing/manual 매칭: 저장된 fulfillments
 * - 없음: 미매칭 amber 버튼 또는 null
 */
function MatchSummary({
  product,
  canMatch,
  onOpen,
}: {
  product: OrderProduct
  canMatch: boolean
  onOpen?: () => void
}) {
  const matched = product.matched ?? null
  const fulfillmentsForTree: OrderFulfillment[] =
    product.fulfillments && product.fulfillments.length > 0
      ? product.fulfillments
      : matched && product.optionId
        ? [
            {
              optionId: product.optionId,
              productName: matched.productName,
              optionName: matched.optionName,
              quantity: product.quantity,
            },
          ]
        : []

  if (fulfillmentsForTree.length > 0) {
    return (
      <button
        type="button"
        disabled={!canMatch}
        onClick={canMatch ? onOpen : undefined}
        className={cn(
          'flex w-full flex-col gap-0.5 rounded-sm border border-emerald-200 bg-emerald-50/60 p-1 text-left',
          canMatch && 'cursor-pointer hover:bg-emerald-50'
        )}
        title={canMatch ? '매칭 수정' : '저장된 주문만 매칭 가능합니다'}
      >
        {fulfillmentsForTree.map((f, fi) => {
          const perSet = product.quantity > 0 ? f.quantity / product.quantity : 0
          const showBreakdown = Number.isInteger(perSet) && perSet >= 1 && product.quantity > 1
          return (
            <div
              key={`${f.optionId}-${fi}`}
              className="flex items-baseline gap-1 text-[10px] leading-tight text-emerald-800"
            >
              <span className="shrink-0 text-emerald-600/70">ㄴ</span>
              <span className="truncate font-medium">
                {f.productName}{' '}
                {f.optionName && (
                  <span className="font-normal text-emerald-700/90">{f.optionName}</span>
                )}
              </span>
              <span className="shrink-0">/ {f.quantity}개</span>
              {showBreakdown && (
                <span className="shrink-0 text-emerald-700/70">
                  ({perSet}장 × {product.quantity}개)
                </span>
              )}
            </div>
          )
        })}
      </button>
    )
  }

  if (product.name) {
    return (
      <button
        type="button"
        disabled={!canMatch}
        onClick={canMatch ? onOpen : undefined}
        className={cn(
          'inline-flex w-full items-center gap-1 rounded-sm border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-left text-[10px] leading-tight text-amber-700',
          canMatch && 'cursor-pointer hover:bg-amber-100'
        )}
        title={canMatch ? '상품 옵션 매칭' : '저장된 주문만 매칭 가능합니다'}
      >
        <Sparkles className="h-3 w-3 shrink-0" />
        <span>{canMatch ? '상품 옵션 매칭' : '미매칭'}</span>
      </button>
    )
  }

  return null
}

/**
 * 상품 이름 셀 — Textarea(name) + 삭제 버튼 + 매칭 트리.
 * 수량은 별도 컬럼에서 관리 (OrderProductQtyCell).
 */
export function OrderProductNamesCell({
  value,
  onChange,
  maxItems = 10,
  invalid = false,
  onOpenMatch,
  matchEnabled = false,
  allowAdd = true,
}: {
  value: OrderProduct[]
  onChange: (products: OrderProduct[]) => void
  maxItems?: number
  invalid?: boolean
  onOpenMatch?: (index: number) => void
  matchEnabled?: boolean
  allowAdd?: boolean
}) {
  function addProduct() {
    if (value.length >= maxItems) return
    onChange([...value, { name: '', quantity: 1 }])
  }

  function removeProduct(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  function updateName(index: number, name: string) {
    onChange(
      value.map((p, i) =>
        i === index
          ? {
              ...p,
              name,
              optionId: null,
              listingId: null,
              matched: null,
              fulfillments: null,
            }
          : p
      )
    )
  }

  return (
    <div className="space-y-2">
      {value.map((product, i) => {
        const canMatch = matchEnabled && !!product.itemId
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-start gap-1">
              <Textarea
                rows={1}
                title={product.name}
                className={cn(
                  'field-sizing-content max-h-12 min-h-7 resize-none px-2 py-1 text-xs leading-tight font-medium shadow-none md:text-xs',
                  invalid && !product.name && 'border-destructive/50 ring-2 ring-destructive/50'
                )}
                value={product.name}
                onChange={(e) => updateName(i, trimStart(e.target.value))}
                placeholder={invalid ? '상품명 *' : '상품명'}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0"
                onClick={() => removeProduct(i)}
                title="삭제"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <MatchSummary product={product} canMatch={canMatch} onOpen={() => onOpenMatch?.(i)} />
          </div>
        )
      })}
      {allowAdd && value.length < maxItems && (
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-6 text-xs', invalid && value.length === 0 && 'text-destructive')}
          onClick={addProduct}
        >
          <Plus className="mr-1 h-3 w-3" />
          {invalid && value.length === 0 ? '상품 추가 *' : '상품 추가'}
        </Button>
      )}
    </div>
  )
}

/**
 * 수량 셀 — 각 아이템마다 QtyInput 하나씩.
 * 아이템별 세로 정렬을 맞추기 위해 상품 셀의 트리/매칭 영역 높이와 같은
 * '보이지 않는 placeholder'를 함께 렌더한다.
 */
export function OrderProductQtyCell({
  value,
  onChange,
  onItemPatch,
}: {
  value: OrderProduct[]
  onChange: (products: OrderProduct[]) => void
  // 저장된 DB 아이템의 수량이 바뀌었을 때 서버에 즉시 PATCH.
  // 응답의 최신 fulfillments로 로컬 상태를 업데이트할 수 있도록 상위가 처리.
  onItemPatch?: (itemId: string, patch: { quantity: number }) => void | Promise<void>
}) {
  function commitQty(index: number, qty: number) {
    const cur = value[index]
    if (!cur || cur.quantity === qty) return
    onChange(value.map((p, i) => (i === index ? { ...p, quantity: qty } : p)))
    if (cur.itemId && onItemPatch) {
      void onItemPatch(cur.itemId, { quantity: qty })
    }
  }

  return (
    <div className="space-y-2">
      {value.map((product, i) => (
        <div key={i} className="space-y-1">
          <QtyInput value={product.quantity} onCommit={(n) => commitQty(i, n)} />
          {/* 상품 셀의 매칭 트리/버튼 높이와 맞추기 위한 invisible placeholder */}
          <div aria-hidden className="invisible">
            <MatchSummary product={product} canMatch={false} />
          </div>
        </div>
      ))}
    </div>
  )
}
