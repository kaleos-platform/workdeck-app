'use client'

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

type OrderProductFieldsProps = {
  value: OrderProduct[]
  onChange: (products: OrderProduct[]) => void
  maxItems?: number
  invalid?: boolean
  // 클릭 시 매칭 다이얼로그 오픈 — 상위에서 처리. 저장된 아이템에서만 활성.
  onOpenMatch?: (index: number) => void
  // 매칭 가능한 상태인지 (저장된 order + channelId 보유 시 true)
  matchEnabled?: boolean
  // '상품 추가' 버튼 노출 여부. 기본 true (신규 수동 입력 행). 저장된 주문에서는 false
  allowAdd?: boolean
}

const trimStart = (v: string) => v.replace(/^\s+/, '')

export function OrderProductFields({
  value,
  onChange,
  maxItems = 10,
  invalid = false,
  onOpenMatch,
  matchEnabled = false,
  allowAdd = true,
}: OrderProductFieldsProps) {
  function addProduct() {
    if (value.length >= maxItems) return
    onChange([...value, { name: '', quantity: 1 }])
  }

  function removeProduct(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  function updateProduct(index: number, field: 'name' | 'quantity', val: string | number) {
    const next: OrderProduct[] = value.map((p, i) => {
      if (i !== index) return p
      // 상품명 직접 수정 시 기존 매칭·fulfillments 해제 (사용자 의도)
      if (field === 'name')
        return {
          ...p,
          name: val as string,
          optionId: null,
          listingId: null,
          matched: null,
          fulfillments: null,
        }
      return { ...p, quantity: val as number }
    })
    onChange(next)
  }

  return (
    <div className="space-y-1">
      {value.map((product, i) => {
        const matched = product.matched ?? null
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
                onChange={(e) => updateProduct(i, 'name', trimStart(e.target.value))}
                placeholder={invalid ? '상품명 *' : '상품명'}
              />
              <Input
                className="h-7 w-14 shrink-0 [appearance:textfield] text-center text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                type="number"
                min={1}
                value={product.quantity}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  updateProduct(i, 'quantity', n >= 1 ? n : 1)
                }}
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
            {(() => {
              // 트리 데이터: 출고 옵션들의 통합 뷰
              // - fulfillments 있음 → 그대로 사용 (listing/manual)
              // - optionId만 있음 → matched 기반 단일 가상 엔트리 (option mode)
              // - 둘 다 없음 → 미매칭
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
                    onClick={canMatch ? () => onOpenMatch?.(i) : undefined}
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-sm border border-emerald-200 bg-emerald-50/60 p-1 text-left',
                      canMatch && 'cursor-pointer hover:bg-emerald-50'
                    )}
                    title={canMatch ? '매칭 수정' : '저장된 주문만 매칭 가능합니다'}
                  >
                    {fulfillmentsForTree.map((f, fi) => {
                      const perSet = product.quantity > 0 ? f.quantity / product.quantity : 0
                      const showBreakdown =
                        Number.isInteger(perSet) && perSet >= 1 && product.quantity > 1
                      return (
                        <div
                          key={`${f.optionId}-${fi}`}
                          className="flex items-baseline gap-1 text-[10px] leading-tight text-emerald-800"
                        >
                          <span className="shrink-0 text-emerald-600/70">ㄴ</span>
                          <span className="truncate font-medium">
                            {f.productName}{' '}
                            {f.optionName && (
                              <span className="font-normal text-emerald-700/90">
                                {f.optionName}
                              </span>
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
                    onClick={canMatch ? () => onOpenMatch?.(i) : undefined}
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
            })()}
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
