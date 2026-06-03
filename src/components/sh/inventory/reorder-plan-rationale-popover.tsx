'use client'

import { useState } from 'react'
import { InfoIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ReorderPlanItem, PlanDetailAccuracy } from './reorder-plan-types'

type Props = {
  item: Pick<ReorderPlanItem, 'rationale' | 'inputsSnapshot' | 'forecastModel' | 'confidenceScore'>
  // 옵션별 예측 검증 결과 (정산 완료 시) — 없으면 미표시
  accuracy?: PlanDetailAccuracy
}

export function ReorderPlanRationalePopover({ item, accuracy }: Props) {
  const [showDebug, setShowDebug] = useState(false)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2">
          <InfoIcon className="h-3.5 w-3.5" />
          <span className="sr-only">근거 보기</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" side="left" align="start">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">예측 근거</p>
          <p className="text-sm leading-relaxed">{item.rationale ?? '근거 정보가 없습니다.'}</p>
        </div>

        {accuracy && (
          <div className="space-y-1.5 rounded-md border border-emerald-200 bg-emerald-50/50 px-2.5 py-2">
            <p className="text-xs font-semibold text-emerald-800">예측 검증 결과</p>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">정확도 (WAPE)</span>
              <span className="font-medium tabular-nums">{(accuracy.wape * 100).toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">편향 (Bias)</span>
              <span className="font-medium tabular-nums">
                {accuracy.bias > 0 ? '+' : ''}
                {(accuracy.bias * 100).toFixed(1)}%{' '}
                {accuracy.bias > 0 ? '(과예측)' : accuracy.bias < 0 ? '(과소예측)' : ''}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">품절 / 과잉</span>
              <span className="font-medium tabular-nums">
                {accuracy.stockoutDays}일 / {accuracy.overstockDays}일
              </span>
            </div>
          </div>
        )}

        {item.confidenceScore !== null && item.confidenceScore !== undefined && (
          <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1.5">
            <span className="text-xs text-muted-foreground">신뢰도</span>
            <span className="text-xs font-medium tabular-nums">
              {(item.confidenceScore * 100).toFixed(0)}%
            </span>
          </div>
        )}

        <div>
          <button
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setShowDebug((v) => !v)}
            type="button"
          >
            {showDebug ? '디버그 숨기기' : '디버그 보기'}
          </button>
          {showDebug && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted/60 p-2 text-[10px] leading-relaxed text-muted-foreground">
              {JSON.stringify(
                {
                  forecastModel: item.forecastModel,
                  ...item.inputsSnapshot,
                },
                null,
                2
              )}
            </pre>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
