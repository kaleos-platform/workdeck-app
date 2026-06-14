'use client'

import { useState } from 'react'
import { Pencil, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { PricingProductPickerDialog } from './pricing-product-picker-dialog'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

/** 부모에게 전달하는 확정된 번들 컴포넌트 */
export type ResolvedComponent = {
  productId: string
  productName: string
  /** 대표 옵션 (매트릭스 계산·표시용) */
  optionId: string
  /** 가격 그룹에 속한 전체 옵션 ID — 채널 상품 일괄 생성에 사용 */
  optionIds: string[]
  costPrice: number
  retailPrice: number
  quantity: number
}

type Props = {
  /** 행 고유 ID — 부모가 관리 (인덱스 대신 안정 ID 사용) */
  rowId: string
  rowIndex: number
  /** 현재 확정값 (부모 보관) — 요약 표시·수정 복원용 */
  resolved: ResolvedComponent | null
  /** onChange(rowId, component | null) */
  onChange: (rowId: string, component: ResolvedComponent | null) => void
  onRemove: (rowId: string) => void
  showRemove: boolean
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────────

/**
 * 상품 구성 행 1개 — "상품 선택" 버튼으로 팝업을 열어 상품·가격그룹·수량을 설정한다.
 * 확정 후에는 요약(상품명·가격그룹·원가/소비자가·수량)과 "수정" 버튼을 표시한다.
 * 검색/가격그룹/옵션 선택 UI는 모두 PricingProductPickerDialog로 이동.
 */
export function BundleRow({ rowId, rowIndex, resolved, onChange, onRemove, showRemove }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      {/* 행 헤더: 번호 + 제거 버튼 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">상품 {rowIndex + 1}</span>
        {showRemove && (
          <button
            type="button"
            onClick={() => onRemove(rowId)}
            className="text-muted-foreground hover:text-destructive"
            aria-label="행 제거"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {resolved ? (
        /* ── 요약 ── */
        <div className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-sm font-medium">{resolved.productName}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>
                원가{' '}
                <span className="font-medium text-foreground">{fmt(resolved.costPrice)}원</span>
              </span>
              <span>
                소비자가{' '}
                <span className="font-medium text-foreground">{fmt(resolved.retailPrice)}원</span>
              </span>
              <span>
                옵션{' '}
                <span className="font-medium text-foreground">{resolved.optionIds.length}개</span>
              </span>
              {resolved.quantity > 1 && (
                <Badge variant="secondary" className="text-[10px]">
                  수량 {resolved.quantity}
                </Badge>
              )}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 text-xs"
            onClick={() => setPickerOpen(true)}
          >
            <Pencil className="h-3 w-3" />
            수정
          </Button>
        </div>
      ) : (
        /* ── 미설정: 상품 선택 버튼 ── */
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={() => setPickerOpen(true)}
        >
          상품 선택
        </Button>
      )}

      <PricingProductPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initial={resolved}
        onConfirm={(comp) => onChange(rowId, comp)}
      />
    </div>
  )
}
