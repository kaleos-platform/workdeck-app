'use client'

import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const MAX_KEYWORDS = 30

type Props = {
  value: string[]
  onChange: (next: string[]) => void
  suggestions?: string[]
  placeholder?: string
}

export function KeywordEditor({ value, onChange, suggestions = [], placeholder }: Props) {
  const [draft, setDraft] = useState('')

  const normalized = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value])

  function add(raw: string) {
    const keyword = raw.trim()
    if (!keyword) return
    if (normalized.has(keyword.toLowerCase())) return
    if (value.length >= MAX_KEYWORDS) return
    onChange([...value, keyword])
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (draft.trim()) {
        add(draft)
        setDraft('')
      }
    } else if (e.key === 'Backspace' && draft.length === 0 && value.length > 0) {
      remove(value.length - 1)
    }
  }

  const freshSuggestions = suggestions.filter((s) => !normalized.has(s.toLowerCase())).slice(0, 8)
  const atMax = value.length >= MAX_KEYWORDS

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 rounded-md border bg-background px-2 py-2 focus-within:border-primary/50">
        {value.map((v, idx) => (
          <Badge
            key={`${v}-${idx}`}
            variant="secondary"
            className="gap-1 pr-1.5 pl-2.5 text-sm font-normal"
          >
            <span>{v}</span>
            <button
              type="button"
              onClick={() => remove(idx)}
              aria-label={`키워드 ${v} 제거`}
              className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={atMax ? `최대 ${MAX_KEYWORDS}개` : (placeholder ?? '키워드 입력 후 Enter')}
          disabled={atMax}
          className="h-7 min-w-[140px] flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {value.length} / {MAX_KEYWORDS} · Enter 또는 ,(쉼표)로 추가, Backspace로 마지막 삭제
      </p>
      {freshSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-muted-foreground">추천:</span>
          {freshSuggestions.map((s) => (
            <Button
              key={s}
              type="button"
              variant="outline"
              size="sm"
              disabled={atMax}
              onClick={() => add(s)}
              className="h-6 gap-1 px-2 text-xs"
            >
              <Plus className="h-3 w-3" />
              {s}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
