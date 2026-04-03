'use client'

import { Trash2, TrendingUp, Pause, DollarSign } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Suggestion, SuggestionType } from '@/types/analysis'

const TYPE_CONFIG: Record<
  SuggestionType,
  { icon: typeof Trash2; label: string }
> = {
  REMOVE_KEYWORD: { icon: Trash2, label: '키워드 제거' },
  ADJUST_BID: { icon: TrendingUp, label: '입찰가 조정' },
  PAUSE_CAMPAIGN: { icon: Pause, label: '캠페인 일시중지' },
  ADJUST_BUDGET: { icon: DollarSign, label: '예산 조정' },
}

const PRIORITY_STYLES = {
  HIGH: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  MEDIUM:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  LOW: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
} as const

const PRIORITY_LABEL = {
  HIGH: '높음',
  MEDIUM: '보통',
  LOW: '낮음',
} as const

type SuggestionListProps = {
  suggestions: Suggestion[]
}

export function SuggestionList({ suggestions }: SuggestionListProps) {
  if (suggestions.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        개선 제안이 없습니다
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {suggestions.map((suggestion, idx) => {
        const config = TYPE_CONFIG[suggestion.type]
        const Icon = config.icon

        return (
          <div
            key={`${suggestion.campaignId}-${suggestion.type}-${idx}`}
            className="flex items-start gap-3 rounded-lg border p-3"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    'border-transparent text-[11px]',
                    PRIORITY_STYLES[suggestion.priority]
                  )}
                >
                  {PRIORITY_LABEL[suggestion.priority]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {config.label}
                </span>
              </div>

              <p className="text-sm font-medium">{suggestion.target}</p>
              <p className="text-xs text-muted-foreground">
                {suggestion.reason}
              </p>

              {suggestion.currentValue != null &&
                suggestion.suggestedValue != null && (
                  <p className="text-xs">
                    <span className="text-muted-foreground">현재</span>{' '}
                    <span className="font-medium">
                      {suggestion.currentValue.toLocaleString('ko-KR')}
                    </span>
                    <span className="mx-1 text-muted-foreground">&rarr;</span>
                    <span className="font-medium text-blue-600 dark:text-blue-400">
                      {suggestion.suggestedValue.toLocaleString('ko-KR')}
                    </span>
                  </p>
                )}

              {suggestion.estimatedImpact && (
                <p className="text-xs text-muted-foreground">
                  예상 효과: {suggestion.estimatedImpact}
                </p>
              )}
            </div>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" disabled>
                    승인
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Phase 3에서 활성화</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )
      })}
    </div>
  )
}
