'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { AnalysisRule } from '@/types/analysis'

const SOURCE_LABELS: Record<AnalysisRule['source'], { label: string; className: string }> = {
  user: { label: '사용자', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  model: { label: '모델', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  system: { label: '시스템', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
}

export function AnalysisRules() {
  const [rules, setRules] = useState<AnalysisRule[]>([])
  const [loading, setLoading] = useState(true)
  const [newRule, setNewRule] = useState('')
  const [adding, setAdding] = useState(false)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/analysis/rules')
      if (res.ok) {
        const data = await res.json()
        setRules(Array.isArray(data) ? data : data.rules ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRules()
  }, [fetchRules])

  async function handleAdd() {
    const trimmed = newRule.trim()
    if (!trimmed) return

    setAdding(true)
    try {
      const res = await fetch('/api/analysis/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule: trimmed, source: 'user' }),
      })
      if (res.ok) {
        setNewRule('')
        await fetchRules()
      }
    } finally {
      setAdding(false)
    }
  }

  async function handleToggle(rule: AnalysisRule) {
    setTogglingIds((prev) => new Set(prev).add(rule.id))
    try {
      const res = await fetch(`/api/analysis/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !rule.isActive }),
      })
      if (res.ok) {
        setRules((prev) =>
          prev.map((r) => (r.id === rule.id ? { ...r, isActive: !r.isActive } : r))
        )
      }
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(rule.id)
        return next
      })
    }
  }

  async function handleDelete(id: string) {
    setDeletingIds((prev) => new Set(prev).add(id))
    try {
      const res = await fetch(`/api/analysis/rules/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.id !== id))
      }
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      handleAdd()
    }
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">규칙 목록</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 규칙 추가 */}
        <div className="flex items-center gap-2">
          <Input
            placeholder="새 규칙을 입력하세요..."
            value={newRule}
            onChange={(e) => setNewRule(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={adding}
            className="flex-1"
          />
          <Button size="sm" disabled={adding || !newRule.trim()} onClick={handleAdd} className="gap-1">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            규칙 추가
          </Button>
        </div>

        {/* 규칙 리스트 */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rules.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            등록된 규칙이 없습니다. 위에서 새 규칙을 추가하세요.
          </p>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => {
              const sourceStyle = SOURCE_LABELS[rule.source]
              return (
                <div
                  key={rule.id}
                  className={cn(
                    'flex items-center justify-between gap-4 rounded-lg border p-3',
                    !rule.isActive && 'opacity-60'
                  )}
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{rule.rule}</p>
                      <Badge variant="secondary" className={cn('text-[10px]', sourceStyle.className)}>
                        {sourceStyle.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>적용 {rule.appliedCount}회</span>
                      <span>{formatDate(rule.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Switch
                      checked={rule.isActive}
                      disabled={togglingIds.has(rule.id)}
                      onCheckedChange={() => handleToggle(rule)}
                    />
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={deletingIds.has(rule.id)}
                      onClick={() => handleDelete(rule.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      {deletingIds.has(rule.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
