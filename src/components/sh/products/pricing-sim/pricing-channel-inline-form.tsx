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
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

export type ChannelInlineData = {
  name: string
  defaultFeePct: number // 0~1
  shippingFee: number
  freeShippingThreshold: number
  applyAdCost: boolean
  paymentFeeIncluded: boolean
  paymentFeePct: number // 0~1 (paymentFeeIncluded=false 일 때)
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 수정 모드: 기존 값 전달 */
  initialData?: Partial<ChannelInlineData>
  onConfirm: (data: ChannelInlineData) => void
}

// ─── 기본값 ────────────────────────────────────────────────────────────────────

const DEFAULT_DATA: ChannelInlineData = {
  name: '',
  defaultFeePct: 0,
  shippingFee: 0,
  freeShippingThreshold: 0,
  applyAdCost: false,
  paymentFeeIncluded: true,
  paymentFeePct: 0,
}

// ─── 숫자 입력 공통 컴포넌트 ──────────────────────────────────────────────────

function NumField({
  label,
  value,
  onChange,
  suffix,
  min = 0,
  max,
  step = 1,
  id,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  suffix: string
  min?: number
  max?: number
  step?: number
  id: string
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="relative flex items-center">
        <Input
          id={id}
          type="number"
          value={value || ''}
          min={min}
          max={max}
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

export function PricingChannelInlineForm({ open, onOpenChange, initialData, onConfirm }: Props) {
  const nameId = useId()
  const feeId = useId()
  const shipId = useId()
  const threshId = useId()
  const pgId = useId()

  const [data, setData] = useState<ChannelInlineData>({
    ...DEFAULT_DATA,
    ...initialData,
  })

  function patch(partial: Partial<ChannelInlineData>) {
    setData((prev) => ({ ...prev, ...partial }))
  }

  function handleConfirm() {
    if (!data.name.trim()) return
    onConfirm({ ...data, name: data.name.trim() })
    onOpenChange(false)
  }

  const isValid = data.name.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>임시 채널 설정</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* 채널명 */}
          <div className="space-y-1.5">
            <Label htmlFor={nameId} className="text-xs">
              채널명 *
            </Label>
            <Input
              id={nameId}
              value={data.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="예: 내 쇼핑몰"
              maxLength={100}
              className="h-8 text-sm"
            />
          </div>

          {/* 채널 수수료율 / 배송비 / 무료배송 기준 */}
          <div className="grid grid-cols-2 gap-3">
            <NumField
              id={feeId}
              label="채널 수수료 (%)"
              value={data.defaultFeePct * 100}
              onChange={(v) => patch({ defaultFeePct: v / 100 })}
              suffix="%"
              min={0}
              max={100}
              step={0.1}
            />
            <NumField
              id={shipId}
              label="배송비 (원)"
              value={data.shippingFee}
              onChange={(v) => patch({ shippingFee: v })}
              suffix="원"
            />
            <NumField
              id={threshId}
              label="무료배송 기준 (원)"
              value={data.freeShippingThreshold}
              onChange={(v) => patch({ freeShippingThreshold: v })}
              suffix="원"
            />
          </div>

          {/* 스위치 행 */}
          <div className="space-y-2">
            {/* 광고비 적용 */}
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <p className="text-xs font-medium">광고비 적용</p>
                <p className="text-[10px] text-muted-foreground">글로벌 광고비% 이 채널에 적용</p>
              </div>
              <Switch
                checked={data.applyAdCost}
                onCheckedChange={(v) => patch({ applyAdCost: v })}
              />
            </div>

            {/* 결제 수수료 포함 */}
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <p className="text-xs font-medium">결제 수수료 포함</p>
                <p className="text-[10px] text-muted-foreground">
                  {data.paymentFeeIncluded
                    ? '채널 수수료에 PG 수수료 포함됨'
                    : '별도 PG 수수료 발생'}
                </p>
              </div>
              <Switch
                checked={data.paymentFeeIncluded}
                onCheckedChange={(v) => patch({ paymentFeeIncluded: v })}
              />
            </div>

            {/* 결제 수수료율 — paymentFeeIncluded=false 일 때만 */}
            {!data.paymentFeeIncluded && (
              <div className="pl-3">
                <NumField
                  id={pgId}
                  label="결제(PG) 수수료율 (%)"
                  value={data.paymentFeePct * 100}
                  onChange={(v) => patch({ paymentFeePct: v / 100 })}
                  suffix="%"
                  min={0}
                  max={10}
                  step={0.1}
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!isValid}>
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
