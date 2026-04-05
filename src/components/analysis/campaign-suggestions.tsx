'use client'

import {
  Trash2,
  TrendingUp,
  Pause,
  DollarSign,
  ArrowRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { Suggestion, SuggestionType, SuggestionPriority } from '@/types/analysis'

const TYPE_CONFIG: Record<
  SuggestionType,
  { icon: typeof Trash2; label: string; className: string }
> = {
  REMOVE_KEYWORD: {
    icon: Trash2,
    label: '키워드 제거',
    className: 'text-red-500',
  },
  ADJUST_BID: {
    icon: TrendingUp,
    label: '입찰 조정',
    className: 'text-blue-500',
  },
  PAUSE_CAMPAIGN: {
    icon: Pause,
    label: '캠페인 일시정지',
    className: 'text-orange-500',
  },
  ADJUST_BUDGET: {
    icon: DollarSign,
    label: '예산 조정',
    className: 'text-emerald-500',
  },
}

const PRIORITY_CONFIG: Record<
  SuggestionPriority,
  { label: string; variant: 'destructive' | 'secondary' | 'outline'; className: string }
> = {
  HIGH: {
    label: '높음',
    variant: 'destructive',
    className: '',
  },
  MEDIUM: {
    label: '보통',
    variant: 'outline',
    className: 'border-yellow-400 bg-yellow-50 text-yellow-700 dark:border-yellow-500/50 dark:bg-yellow-900/20 dark:text-yellow-400',
  },
  LOW: {
    label: '낮음',
    variant: 'secondary',
    className: '',
  },
}

type CampaignSuggestionsProps = {
  suggestions: Suggestion[]
  campaignNames?: Record<string, string>
}

export function CampaignSuggestions({ suggestions, campaignNames }: CampaignSuggestionsProps) {
  if (!suggestions || suggestions.length === 0) return null

  // Group suggestions by campaignId
  const grouped = suggestions.reduce<Record<string, Suggestion[]>>(
    (acc, suggestion) => {
      const key = suggestion.campaignId || 'unknown'
      if (!acc[key]) acc[key] = []
      acc[key].push(suggestion)
      return acc
    },
    {}
  )

  const campaignIds = Object.keys(grouped)

  return (
    <div className="space-y-4">
      {campaignIds.map((campaignId, idx) => {
        const items = grouped[campaignId]
        // Use the first suggestion's target as a fallback campaign name
        const campaignLabel =
          campaignId !== 'unknown'
            ? campaignNames?.[campaignId] || campaignId
            : '미분류 캠페인'

        return (
          <Card key={campaignId}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  {campaignLabel}
                </CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {items.length}건
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((suggestion, i) => {
                const typeConfig = TYPE_CONFIG[suggestion.type]
                const priorityConfig = PRIORITY_CONFIG[suggestion.priority]
                const Icon = typeConfig.icon

                return (
                  <div key={i}>
                    {i > 0 && <Separator className="mb-3" />}
                    <div className="flex items-start gap-3">
                      {/* Type Icon */}
                      <div
                        className={cn(
                          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/60',
                          typeConfig.className
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">
                            {suggestion.target}
                          </span>
                          <Badge
                            variant={priorityConfig.variant}
                            className={cn('text-[10px]', priorityConfig.className)}
                          >
                            {priorityConfig.label}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {typeConfig.label}
                          </Badge>
                        </div>

                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {suggestion.reason}
                        </p>

                        {/* Current → Suggested value */}
                        {suggestion.currentValue != null &&
                          suggestion.suggestedValue != null && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                                {suggestion.currentValue.toLocaleString()}
                              </span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono font-medium text-primary">
                                {suggestion.suggestedValue.toLocaleString()}
                              </span>
                              {suggestion.estimatedImpact && (
                                <span className="text-muted-foreground">
                                  ({suggestion.estimatedImpact})
                                </span>
                              )}
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
