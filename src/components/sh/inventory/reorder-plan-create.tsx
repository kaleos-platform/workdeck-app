'use client'

import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { OptionPickerDialog } from '@/components/sh/products/listings/option-picker-dialog'
import { ReorderTable } from '@/components/sh/inventory/reorder-table'

type PickedProduct = {
  productId: string
  productName: string
  brandName: string | null
}

type Props = {
  /** 생성 모드 진입 시 상품 선택 팝업을 자동으로 연다 */
  autoOpen?: boolean
  /** 상품 미선택 상태로 팝업을 닫으면 호출 (목록으로 복귀) */
  onCancel?: () => void
}

/**
 * 상품 단위 발주 계획 생성 플로우.
 *
 * 1) 진입 시 OptionPickerDialog(product-with-all-options) 자동 표시 → 상품 선택
 * 2) 선택 후 인라인으로 해당 상품의 옵션별 예측표(ReorderTable 단일상품 모드) 표시
 *    - 예측표 내 "발주 계획 생성" 버튼이 POST /reorder/plan { productId } 를 호출하고
 *      성공 시 계획 상세 페이지로 이동한다.
 * 3) 상품 미선택으로 팝업을 닫으면 onCancel (목록 복귀)
 */
export function ReorderPlanCreate({ autoOpen = true, onCancel }: Props) {
  const [pickerOpen, setPickerOpen] = useState(autoOpen)
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

  // 팝업 닫힘 처리: 상품 미선택 상태로 닫으면 목록 복귀
  const handlePickerOpenChange = (open: boolean) => {
    setPickerOpen(open)
    if (!open && !picked) onCancel?.()
  }

  if (!picked) {
    return (
      <OptionPickerDialog
        open={pickerOpen}
        onOpenChange={handlePickerOpenChange}
        mode="product-with-all-options"
        onPickProduct={handlePickProduct}
        contextLabel="발주 계획"
      />
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
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setPicked(null)
            setPickerOpen(true)
          }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          다른 상품 선택
        </Button>
      </div>

      {/* 단일상품 모드: 필터 드롭다운 숨김, 내장 "발주 계획 생성" 버튼이 productId로 POST */}
      <ReorderTable productId={picked.productId} />
    </div>
  )
}
