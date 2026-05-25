'use client'

import { useState } from 'react'
import { InfoIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ReorderPlanItem } from './reorder-plan-types'

type Props = {
  item: Pick<ReorderPlanItem, 'rationale' | 'inputsSnapshot' | 'forecastModel' | 'confidenceScore'>
}

export function ReorderPlanRationalePopover({ item }: Props) {
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
