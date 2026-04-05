'use client'

import { useState } from 'react'
import { Lightbulb, Check, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { ImprovementSuggestion } from '@/types/analysis'

type SuggestionListProps = {
  improvementSuggestions: ImprovementSuggestion[]
}

export function SuggestionList({ improvementSuggestions }: SuggestionListProps) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [applying, setApplying] = useState<Set<number>>(new Set())
  const [applied, setApplied] = useState<Set<number>>(new Set())

  async function handleApply(suggestion: ImprovementSuggestion, index: number) {
    setApplying((prev) => new Set(prev).add(index))
    try {
      const res = await fetch('/api/analysis/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule: suggestion.rule, source: 'model' }),
      })
      if (res.ok) {
        setApplied((prev) => new Set(prev).add(index))
      }
    } finally {
      setApplying((prev) => {
        const next = new Set(prev)
        next.delete(index)
        return next
      })
    }
  }

  function handleDismiss(index: number) {
    setDismissed((prev) => new Set(prev).add(index))
  }

  const visibleSuggestions = improvementSuggestions.filter(
    (_, i) => !dismissed.has(i) && !applied.has(i)
  )

  if (visibleSuggestions.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="h-5 w-5 text-yellow-500" />
          분석 개선 제안
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {improvementSuggestions.map((suggestion, index) => {
          if (dismissed.has(index) || applied.has(index)) return null

          return (
            <div
              key={index}
              className="flex items-start justify-between gap-4 rounded-lg border p-4"
            >
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium">{suggestion.rule}</p>
                <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="default"
                  className="gap-1"
                  disabled={applying.has(index)}
                  onClick={() => handleApply(suggestion, index)}
                >
                  <Check className="h-3.5 w-3.5" />
                  적용
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1"
                  onClick={() => handleDismiss(index)}
                >
                  <X className="h-3.5 w-3.5" />
                  무시
                </Button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
