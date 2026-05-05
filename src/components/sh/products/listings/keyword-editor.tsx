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

  function parseKeywords(raw: string) {
    return raw
      .split(/[,\n]/)
      .map((token) => token.trim())
      .filter(Boolean)
  }

  function addMany(raw: string) {
    const incoming = parseKeywords(raw)
    if (incoming.length === 0) return

    const next = [...value]
    const seen = new Set(normalized)

    for (const keyword of incoming) {
      if (seen.has(keyword.toLowerCase())) continue
      if (next.length >= MAX_KEYWORDS) break
      next.push(keyword)
      seen.add(keyword.toLowerCase())
    }

    if (next.length !== value.length) {
      onChange(next)
    }
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // 한글 등 IME 조합 중인 Enter는 무시 (조합 확정용)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (draft.trim()) {
        addMany(draft)
        setDraft('')
      }
    } else if (e.key === 'Backspace' && draft.length === 0 && value.length > 0) {
      remove(value.length - 1)
    }
  }

  function onInputPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text')
    if (!/[,\n]/.test(pasted)) return

    e.preventDefault()
    addMany(pasted)
    setDraft('')
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
          onPaste={onInputPaste}
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
              onClick={() => addMany(s)}
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
