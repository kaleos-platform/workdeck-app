'use client'

import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import type { ResolvedComponent } from './pricing-bundle-row'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

type Props = {
  /** 현재 확정값 (부모 보관) — 복원용 초기값 */
  resolved: ResolvedComponent | null
  /** 유효(상품명+소비자가>0)하면 ResolvedComponent, 아니면 null */
  onChange: (component: ResolvedComponent | null) => void
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

/** 숫자 문자열 파싱 (빈값·음수·NaN → 0) */
function num(v: string): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────────

/**
 * 신규(미등록) 상품 직접 입력 행 — 상품명·원가·소비자가·수량을 사용자가 타이핑한다.
 * 상품 피커 없이 매트릭스 엔진 입력(costPrice/retailPrice/quantity)을 직접 구성.
 * 유효 조건: 상품명 있음 + 소비자가>0 (원가 0 허용). productId/optionId는 빈 값.
 */
export function ManualProductRow({ resolved, onChange }: Props) {
  const [name, setName] = useState(resolved?.productName ?? '')
  const [cost, setCost] = useState(resolved?.costPrice ? String(resolved.costPrice) : '')
  const [retail, setRetail] = useState(resolved?.retailPrice ? String(resolved.retailPrice) : '')
  const [qty, setQty] = useState(resolved?.quantity ? String(resolved.quantity) : '1')

  // 입력 변경 → 유효성 판정 후 부모로 emit (신규 상태 계산)
  const emit = (next: { name: string; cost: string; retail: string; qty: string }) => {
    const retailPrice = num(next.retail)
    const trimmed = next.name.trim()
    if (!trimmed || retailPrice <= 0) {
      onChange(null)
      return
    }
    onChange({
      productId: '',
      productName: trimmed,
      optionId: '',
      optionIds: [],
      costPrice: num(next.cost),
      retailPrice,
      quantity: Math.max(1, Math.round(num(next.qty) || 1)),
    })
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <p className="text-xs font-semibold text-muted-foreground">신규 상품</p>

      <div className="space-y-1">
        <Label htmlFor="manual-name" className="text-[11px] text-muted-foreground">
          상품명
        </Label>
        <Input
          id="manual-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            emit({ name: e.target.value, cost, retail, qty })
          }}
          placeholder="예: 신규 개발 상품 A"
          className="h-8 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumField
          id="manual-cost"
          label="원가"
          value={cost}
          onChange={(v) => {
            setCost(v)
            emit({ name, cost: v, retail, qty })
          }}
        />
        <NumField
          id="manual-retail"
          label="소비자가"
          value={retail}
          onChange={(v) => {
            setRetail(v)
            emit({ name, cost, retail: v, qty })
          }}
        />
      </div>

      <div className="w-24 space-y-1">
        <Label htmlFor="manual-qty" className="text-[11px] text-muted-foreground">
          수량
        </Label>
        <Input
          id="manual-qty"
          type="number"
          min={1}
          step={1}
          value={qty}
          onChange={(e) => {
            setQty(e.target.value)
            emit({ name, cost, retail, qty: e.target.value })
          }}
          className="h-8 [appearance:textfield] text-right text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </div>
    </div>
  )
}

// ─── 원 단위 숫자 입력 ──────────────────────────────────────────────────────────

function NumField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px] text-muted-foreground">
        {label}
      </Label>
      <div className="relative flex items-center">
        <Input
          id={id}
          type="number"
          min={0}
          step={100}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className={cn(
            'h-8 [appearance:textfield] pr-7 text-right text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
          )}
        />
        <span className="pointer-events-none absolute right-2.5 text-xs text-muted-foreground">
          원
        </span>
      </div>
    </div>
  )
}
