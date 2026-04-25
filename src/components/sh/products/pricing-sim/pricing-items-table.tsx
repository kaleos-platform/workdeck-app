'use client'

import { useEffect, useRef } from 'react'
import { X, Plus, PackageOpen, PackagePlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { calculatePricing, type PricingResult } from '@/lib/sh/pricing-calc'
import { cn } from '@/lib/utils'

// 테이블 행 상태 타입
export type PricingItemRow = {
  // 식별
  rowId: string // 클라이언트 임시 id
  optionId: string
  productId: string
  optionName: string
  productName: string
  brandName: string | null
  // 입력값 (UI 표시: %, 저장: 0~1)
  costPrice: number
  salePrice: number
  discountRatePct: number // UI: 0~100
  channelFeePct: number // UI: 0~100
  shippingCost: number
  packagingCost: number
  adCostPct: number // UI: 0~100
  operatingCostPct: number // UI: 0~100
  // 계산 결과 (클라이언트 미리보기)
  result: PricingResult
}

type Props = {
  rows: PricingItemRow[]
  includeVat: boolean
  vatRate: number
  onChange: (rows: PricingItemRow[]) => void
  onAddClick: () => void
  /** 판매채널 등록 버튼 클릭 — 행 전달 */
  onRegister?: (row: PricingItemRow) => void
  /** 현재 시나리오 channelId (없으면 undefined) */
  scenarioChannelId?: string | null
}

// 숫자 포맷
function fmt(n: number) {
  return Math.round(n).toLocaleString('ko-KR')
}

// 단일 행의 결과를 재계산하는 헬퍼
function recalc(row: PricingItemRow, includeVat: boolean, vatRate: number): PricingItemRow {
  const result = calculatePricing({
    costPrice: row.costPrice,
    salePrice: row.salePrice,
    discountRate: row.discountRatePct / 100,
    channelFeePct: row.channelFeePct / 100,
    shippingCost: row.shippingCost,
    packagingCost: row.packagingCost,
    adCostPct: row.adCostPct / 100,
    operatingCostPct: row.operatingCostPct / 100,
    includeVat,
    vatRate,
  })
  return { ...row, result }
}

// 숫자 input 공통 컴포넌트
function NumInput({
  value,
  onChange,
  suffix,
  placeholder = '0',
  step = 1,
  className,
}: {
  value: number
  onChange: (v: number) => void
  suffix?: string
  placeholder?: string
  step?: number
  className?: string
}) {
  // 입력 중 빈 문자열 허용을 위해 내부 string state 관리
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={cn('relative flex items-center', className)}>
      <Input
        ref={inputRef}
        type="number"
        defaultValue={value || ''}
        key={value} // 외부에서 값 변경 시 리셋
        step={step}
        min={0}
        placeholder={placeholder}
        className="h-8 w-20 [appearance:textfield] pr-6 text-right text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        onChange={(e) => {
          const v = e.target.value === '' ? 0 : Number(e.target.value)
          if (!isNaN(v)) onChange(v)
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 text-xs text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  )
}

export function PricingItemsTable({
  rows,
  includeVat,
  vatRate,
  onChange,
  onAddClick,
  onRegister,
  scenarioChannelId,
}: Props) {
  // includeVat / vatRate 변경 시 전체 행 재계산
  useEffect(() => {
    onChange(rows.map((r) => recalc(r, includeVat, vatRate)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeVat, vatRate])

  function updateRow(rowId: string, patch: Partial<PricingItemRow>) {
    onChange(
      rows.map((r) => {
        if (r.rowId !== rowId) return r
        const updated = { ...r, ...patch }
        return recalc(updated, includeVat, vatRate)
      })
    )
  }

  function removeRow(rowId: string) {
    onChange(rows.filter((r) => r.rowId !== rowId))
  }

  // 빈 상태
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <PackageOpen className="h-10 w-10 text-muted-foreground/50" />
        <div>
          <p className="font-medium text-muted-foreground">추가된 옵션이 없습니다</p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            아래 버튼을 눌러 시뮬레이션할 옵션을 추가하세요.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onAddClick}>
          <Plus className="mr-1.5 h-4 w-4" />
          옵션 추가
        </Button>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="max-h-[60vh] overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <tr>
              <th className="border-b px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">
                옵션
              </th>
              <th className="border-b px-2 py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground">
                원가
              </th>
              <th className="border-b px-2 py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground">
                판매가
              </th>
              <th className="border-b px-2 py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground">
                할인
              </th>
              <th className="border-b px-2 py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground">
                채널수수료
              </th>
              <th className="border-b px-2 py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground">
                배송비
              </th>
              <th className="border-b px-2 py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground">
                포장비
              </th>
              <th className="border-b px-2 py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground">
                광고비
              </th>
              <th className="border-b px-2 py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground">
                운영비
              </th>
              <th className="border-b px-2 py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground">
                결과
              </th>
              <th className="border-b px-2 py-2" />
              {onRegister && <th className="border-b px-2 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const isLoss = row.result.netProfit < 0
              return (
                <tr
                  key={row.rowId}
                  className={cn(
                    'transition-colors hover:bg-muted/30',
                    isLoss && 'bg-destructive/5'
                  )}
                >
                  {/* 옵션 셀 */}
                  <td className="max-w-[180px] px-3 py-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{row.productName}</p>
                          <p className="truncate text-xs text-muted-foreground">{row.optionName}</p>
                          {row.brandName && (
                            <span className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {row.brandName}
                            </span>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="font-medium">{row.productName}</p>
                        <p className="text-muted-foreground">{row.optionName}</p>
                      </TooltipContent>
                    </Tooltip>
                  </td>

                  {/* 원가 */}
                  <td className="px-2 py-2">
                    <NumInput
                      value={row.costPrice}
                      suffix="원"
                      onChange={(v) => updateRow(row.rowId, { costPrice: v })}
                    />
                  </td>

                  {/* 판매가 */}
                  <td className="px-2 py-2">
                    <NumInput
                      value={row.salePrice}
                      suffix="원"
                      onChange={(v) => updateRow(row.rowId, { salePrice: v })}
                    />
                  </td>

                  {/* 할인% */}
                  <td className="px-2 py-2">
                    <NumInput
                      value={row.discountRatePct}
                      suffix="%"
                      step={0.1}
                      onChange={(v) => updateRow(row.rowId, { discountRatePct: Math.min(100, v) })}
                    />
                  </td>

                  {/* 채널수수료% */}
                  <td className="px-2 py-2">
                    <NumInput
                      value={row.channelFeePct}
                      suffix="%"
                      step={0.1}
                      onChange={(v) => updateRow(row.rowId, { channelFeePct: Math.min(100, v) })}
                    />
                  </td>

                  {/* 배송비 */}
                  <td className="px-2 py-2">
                    <NumInput
                      value={row.shippingCost}
                      suffix="원"
                      onChange={(v) => updateRow(row.rowId, { shippingCost: v })}
                    />
                  </td>

                  {/* 포장비 */}
                  <td className="px-2 py-2">
                    <NumInput
                      value={row.packagingCost}
                      suffix="원"
                      onChange={(v) => updateRow(row.rowId, { packagingCost: v })}
                    />
                  </td>

                  {/* 광고비% */}
                  <td className="px-2 py-2">
                    <NumInput
                      value={row.adCostPct}
                      suffix="%"
                      step={0.1}
                      onChange={(v) => updateRow(row.rowId, { adCostPct: Math.min(100, v) })}
                    />
                  </td>

                  {/* 운영비% */}
                  <td className="px-2 py-2">
                    <NumInput
                      value={row.operatingCostPct}
                      suffix="%"
                      step={0.1}
                      onChange={(v) => updateRow(row.rowId, { operatingCostPct: Math.min(100, v) })}
                    />
                  </td>

                  {/* 결과 셀 */}
                  <td className="px-2 py-2 text-right">
                    <div className="space-y-0.5 text-xs">
                      <p className="text-muted-foreground">매출 {fmt(row.result.revenueExVat)}원</p>
                      <p className="text-muted-foreground">비용 {fmt(row.result.totalCost)}원</p>
                      <p
                        className={cn(
                          'font-semibold',
                          row.result.netProfit >= 0 ? 'text-green-600' : 'text-destructive'
                        )}
                      >
                        순수익 {fmt(row.result.netProfit)}원
                      </p>
                      <p
                        className={cn(
                          row.result.margin >= 0 ? 'text-muted-foreground' : 'text-destructive'
                        )}
                      >
                        마진 {(row.result.margin * 100).toFixed(1)}%
                      </p>
                    </div>
                  </td>

                  {/* 삭제 */}
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => removeRow(row.rowId)}
                      className="rounded p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                      aria-label="행 삭제"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </td>

                  {/* 판매채널 등록 */}
                  {onRegister && (
                    <td className="px-2 py-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => onRegister(row)}
                            className="rounded p-1 text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                            aria-label="판매채널 상품으로 등록"
                          >
                            <PackagePlus className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          {scenarioChannelId ? '판매채널 상품으로 등록' : '채널을 먼저 지정하세요'}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* + 옵션 추가 버튼 */}
      <Button size="sm" variant="outline" className="mt-2" onClick={onAddClick}>
        <Plus className="mr-1.5 h-4 w-4" />
        옵션 추가
      </Button>
    </TooltipProvider>
  )
}
