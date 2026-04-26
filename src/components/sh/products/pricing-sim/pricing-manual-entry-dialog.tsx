'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

export type ManualEntryData = {
  manualName: string
  manualBrandName: string
  costPrice: number
  retailPrice: number
  unitsPerSet: number
  /** 소비자가(MSRP) — 선택. 비워두면 판매가 할인율 비교 미표시 */
  consumerPrice?: number
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 확인 클릭 시 부모 콜백 */
  onAdd: (data: ManualEntryData) => void
}

// ─── 숫자 입력 공통 컴포넌트 ──────────────────────────────────────────────────

function NumField({
  label,
  value,
  onChange,
  suffix,
  min = 0,
  step = 1,
  id,
  required,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  suffix: string
  min?: number
  step?: number
  id: string
  required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      <div className="relative flex items-center">
        <Input
          id={id}
          type="number"
          value={value || ''}
          min={min}
          step={step}
          onChange={(e) => {
            const v = e.target.value === '' ? 0 : Number(e.target.value)
            if (!isNaN(v)) onChange(v)
          }}
          className={cn(
            'h-8 [appearance:textfield] pr-7 text-right text-sm',
            '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
          )}
          placeholder="0"
        />
        <span className="pointer-events-none absolute right-2 text-xs text-muted-foreground">
          {suffix}
        </span>
      </div>
    </div>
  )
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function PricingManualEntryDialog({ open, onOpenChange, onAdd }: Props) {
  const nameId = useId()
  const brandId = useId()
  const costId = useId()
  const retailId = useId()
  const unitsId = useId()
  const consumerPriceId = useId()

  // 폼 상태 — 다이얼로그 열릴 때마다 초기화
  const [manualName, setManualName] = useState('')
  const [manualBrandName, setManualBrandName] = useState('')
  const [costPrice, setCostPrice] = useState(0)
  const [retailPrice, setRetailPrice] = useState(0)
  const [unitsPerSet, setUnitsPerSet] = useState(1)
  const [consumerPrice, setConsumerPrice] = useState(0)

  const isValid = manualName.trim().length > 0

  function handleConfirm() {
    if (!isValid) return
    onAdd({
      manualName: manualName.trim(),
      manualBrandName: manualBrandName.trim(),
      costPrice,
      retailPrice,
      unitsPerSet,
      consumerPrice: consumerPrice > 0 ? consumerPrice : undefined,
    })
    // 폼 리셋
    setManualName('')
    setManualBrandName('')
    setCostPrice(0)
    setRetailPrice(0)
    setUnitsPerSet(1)
    setConsumerPrice(0)
    onOpenChange(false)
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      // 닫힐 때 리셋
      setManualName('')
      setManualBrandName('')
      setCostPrice(0)
      setRetailPrice(0)
      setUnitsPerSet(1)
      setConsumerPrice(0)
    }
    onOpenChange(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>수동 입력</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* 상품명 */}
          <div className="space-y-1.5">
            <Label htmlFor={nameId} className="text-xs">
              상품명 <span className="text-destructive">*</span>
            </Label>
            <Input
              id={nameId}
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="예: 면 티셔츠 L/화이트"
              maxLength={200}
              className="h-8 text-sm"
            />
          </div>

          {/* 브랜드명 */}
          <div className="space-y-1.5">
            <Label htmlFor={brandId} className="text-xs">
              브랜드명
            </Label>
            <Input
              id={brandId}
              value={manualBrandName}
              onChange={(e) => setManualBrandName(e.target.value)}
              placeholder="예: BRAND NAME (선택)"
              maxLength={100}
              className="h-8 text-sm"
            />
          </div>

          {/* 공급가 / 소매가 */}
          <div className="grid grid-cols-2 gap-3">
            <NumField
              id={costId}
              label="공급가 (원)"
              value={costPrice}
              onChange={setCostPrice}
              suffix="원"
            />
            <NumField
              id={retailId}
              label="판매가 / 1세트 (원)"
              value={retailPrice}
              onChange={setRetailPrice}
              suffix="원"
            />
          </div>

          {/* 1세트 = N개 */}
          <NumField
            id={unitsId}
            label="1세트 = N개"
            value={unitsPerSet}
            onChange={(v) => setUnitsPerSet(Math.max(1, Math.round(v)))}
            suffix="개"
            min={1}
          />

          {unitsPerSet > 1 && retailPrice > 0 && (
            <p className="text-[11px] text-muted-foreground">
              1개당 {Math.round(retailPrice / unitsPerSet).toLocaleString('ko-KR')}원 · 공급가 기준
              원가{' '}
              {costPrice > 0
                ? Math.round(costPrice / unitsPerSet).toLocaleString('ko-KR') + '원/개'
                : '미입력'}
            </p>
          )}

          {/* 소비자가 (선택) — 판매가 할인율 비교 표시용 */}
          <NumField
            id={consumerPriceId}
            label="소비자가 (원, 선택)"
            value={consumerPrice}
            onChange={setConsumerPrice}
            suffix="원"
          />
          <p className="text-[11px] text-muted-foreground">
            입력 시 옵션 카드에서 &quot;소비자가 대비 N% 할인&quot; 표시
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
            취소
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!isValid}>
            추가
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
