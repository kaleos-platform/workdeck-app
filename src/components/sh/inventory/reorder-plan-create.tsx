'use client'

import { useState } from 'react'
import { ArrowLeft, PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { OptionPickerDialog } from '@/components/sh/products/listings/option-picker-dialog'
import { ReorderTable } from '@/components/sh/inventory/reorder-table'

type PickedProduct = {
  productId: string
  productName: string
  brandName: string | null
}

/**
 * 상품 단위 발주 계획 생성 플로우.
 *
 * 1) "발주 계획 생성" → OptionPickerDialog(product-with-all-options)로 상품 선택
 * 2) 선택 후 인라인으로 해당 상품의 옵션별 예측표(ReorderTable 단일상품 모드) 표시
 *    - 예측표 내 "발주 계획 생성" 버튼이 POST /reorder/plan { productId } 를 호출하고
 *      성공 시 계획 상세 페이지로 이동한다.
 * 3) "다른 상품 선택"으로 1)로 복귀
 */
export function ReorderPlanCreate() {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [picked, setPicked] = useState<PickedProduct | null>(null)

  const handlePickProduct = (
    productId: string,
    opts: Array<{ productName: string; brandName: string | null }>
  ) => {
    const first = opts[0]
    setPicked({
      productId,
      productName: first?.productName ?? '',
      brandName: first?.brandName ?? null,
    })
    setPickerOpen(false)
  }

  if (!picked) {
    return (
      <div className="rounded-md border border-dashed p-10 text-center">
        <p className="text-sm text-muted-foreground">
          발주 계획은 상품 단위로 수립합니다. 먼저 발주할 상품을 선택해주세요.
        </p>
        <Button className="mt-4 gap-1.5" onClick={() => setPickerOpen(true)}>
          <PlusIcon className="h-4 w-4" />
          발주 계획 생성 (상품 선택)
        </Button>
        <OptionPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          mode="product-with-all-options"
          onPickProduct={handlePickProduct}
          contextLabel="발주 계획"
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{picked.productName}</div>
          {picked.brandName && (
            <div className="text-xs text-muted-foreground">{picked.brandName}</div>
          )}
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPicked(null)}>
          <ArrowLeft className="h-3.5 w-3.5" />
          다른 상품 선택
        </Button>
      </div>

      {/* 단일상품 모드: 필터 드롭다운 숨김, 내장 "발주 계획 생성" 버튼이 productId로 POST */}
      <ReorderTable productId={picked.productId} />
    </div>
  )
}
