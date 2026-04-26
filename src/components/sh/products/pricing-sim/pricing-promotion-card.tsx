'use client'

import { useId, useState } from 'react'
import { Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

export type PromotionValue = {
  type: 'NONE' | 'FLAT' | 'PERCENT' | 'COUPON' | 'MIN_PRICE'
  value: number
}

type Props = {
  value: PromotionValue
  onChange: (v: PromotionValue) => void
  /** true이면 Card wrap 없이 fragment로 렌더 (시나리오 카드 내부에 임베드할 때 사용) */
  embedded?: boolean
}

// ─── 누적 규칙 안내 텍스트 ─────────────────────────────────────────────────────

const RULE_TEXT: Record<PromotionValue['type'], string> = {
  NONE: '',
  MIN_PRICE:
    '프로모션 적용 후 판매가가 이 값을 초과하지 않도록 강제 인하 — 컬럼 할인이 이미 더 낮으면 영향 없음.',
  PERCENT: '할인된 가격 × (1 - 프로모션%) 로 계산됩니다.',
  FLAT: '할인된 가격에서 정액을 차감합니다.',
  COUPON: '할인된 가격에서 쿠폰 금액을 차감합니다.',
}

// 선택 항목 순서: MIN_PRICE 최상단 (Recommended), 나머지는 legacy 표시
const TYPE_ORDER: PromotionValue['type'][] = ['NONE', 'MIN_PRICE', 'PERCENT', 'FLAT', 'COUPON']

const TYPE_LABELS: Record<PromotionValue['type'], string> = {
  NONE: '없음',
  MIN_PRICE: '최소 판매가 (Recommended)',
  PERCENT: '정률 (%) (legacy)',
  FLAT: '정액 (원) (legacy)',
  COUPON: '쿠폰 (원) (legacy)',
}

// 값 입력 필드 라벨
const VALUE_LABEL: Record<PromotionValue['type'], string> = {
  NONE: '',
  MIN_PRICE: '최소 판매가 (원)',
  PERCENT: '할인율',
  FLAT: '할인 금액',
  COUPON: '쿠폰 금액',
}

// ─── 내부 콘텐츠 ───────────────────────────────────────────────────────────────

function PromotionContent({
  value,
  onChange,
}: {
  value: PromotionValue
  onChange: (v: PromotionValue) => void
}) {
  const typeId = useId()
  const valId = useId()

  // 입력 중 string 상태 (number 전환 전)
  const [rawVal, setRawVal] = useState(String(value.value || ''))

  const isPercent = value.type === 'PERCENT'
  const hasValue = value.type !== 'NONE'
  const suffix = isPercent ? '%' : '원'
  const ruleText = RULE_TEXT[value.type]

  function handleTypeChange(t: string) {
    const newType = t as PromotionValue['type']
    const numVal = parseFloat(rawVal) || 0
    onChange({ type: newType, value: numVal })
  }

  function handleValueChange(raw: string) {
    setRawVal(raw)
    const num = parseFloat(raw)
    if (!isNaN(num)) {
      onChange({ ...value, value: num })
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* 타입 선택 */}
      <div className="space-y-1.5">
        <Label htmlFor={typeId} className="text-xs">
          유형
        </Label>
        <Select value={value.type} onValueChange={handleTypeChange}>
          <SelectTrigger id={typeId} className="h-8 w-48 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_ORDER.map((t) => (
              <SelectItem key={t} value={t} className="text-sm">
                {TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 값 입력 (NONE이 아닐 때만) */}
      {hasValue && (
        <div className="space-y-1.5">
          <Label htmlFor={valId} className="text-xs">
            {VALUE_LABEL[value.type]}
          </Label>
          <div className="relative flex items-center">
            <Input
              id={valId}
              type="number"
              value={rawVal}
              min={0}
              max={isPercent ? 100 : undefined}
              step={isPercent ? 0.1 : 100}
              onChange={(e) => handleValueChange(e.target.value)}
              className={cn(
                'h-8 w-28 [appearance:textfield] pr-6 text-right text-sm',
                '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
              )}
              placeholder={isPercent ? '5' : '1000'}
            />
            <span className="pointer-events-none absolute right-2 text-xs text-muted-foreground">
              {suffix}
            </span>
          </div>
        </div>
      )}

      {/* 누적 규칙 안내 */}
      {ruleText && <p className="mb-1.5 text-xs text-muted-foreground">ⓘ {ruleText}</p>}
    </div>
  )
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function PricingPromotionCard({ value, onChange, embedded = false }: Props) {
  // ── embedded 모드: Card wrap 없이 헤딩 + 콘텐츠만 ──
  if (embedded) {
    return (
      <TooltipProvider>
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <h3 className="text-sm font-medium">프로모션</h3>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[240px] text-xs">
                컬럼 할인 후 프로모션이 적용됩니다.
                <br />
                누적 규칙: 컬럼 할인율 → 시나리오 프로모션 순서로 적용.
              </TooltipContent>
            </Tooltip>
          </div>
          <PromotionContent value={value} onChange={onChange} />
        </div>
      </TooltipProvider>
    )
  }

  // ── 기본 모드: Card wrap 유지 ──
  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium">프로모션</CardTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[240px] text-xs">
                컬럼 할인 후 프로모션이 적용됩니다.
                <br />
                누적 규칙: 컬럼 할인율 → 시나리오 프로모션 순서로 적용.
              </TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>

        <CardContent>
          <PromotionContent value={value} onChange={onChange} />
        </CardContent>
      </Card>
    </TooltipProvider>
  )
}
