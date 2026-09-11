'use client'

import { useEffect, useRef, useState } from 'react'
import { Copy, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type VariantTab = { id: string; name: string }

/** 가격 시뮬 옵션 조합(탭) 바 — 전환/추가/이름편집/복제/삭제 */
export function PricingVariantTabs({
  tabs,
  activeId,
  onSelect,
  onAdd,
  onRename,
  onRemove,
  onDuplicate,
}: {
  tabs: VariantTab[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onDuplicate: (id: string) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) inputRef.current?.focus()
  }, [editingId])

  const startEdit = (tab: VariantTab) => {
    setDraft(tab.name)
    setEditingId(tab.id)
  }

  const commit = () => {
    if (editingId) onRename(editingId, draft)
    setEditingId(null)
  }

  return (
    <div className="mb-4 flex items-center gap-1 overflow-x-auto pb-1">
      {tabs.map((tab) => {
        const active = tab.id === activeId
        const editing = editingId === tab.id
        return (
          <div
            key={tab.id}
            className={cn(
              'group relative flex shrink-0 items-center gap-0.5 rounded-md border px-2.5 py-1.5 text-sm',
              active
                ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                : 'border-transparent bg-muted/50 text-muted-foreground hover:bg-muted'
            )}
          >
            {editing ? (
              <Input
                ref={inputRef}
                value={draft}
                maxLength={50}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commit()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setEditingId(null)
                  }
                }}
                className="h-6 w-28 px-1 text-sm"
              />
            ) : (
              <button
                type="button"
                onClick={() => (active ? startEdit(tab) : onSelect(tab.id))}
                onDoubleClick={() => startEdit(tab)}
                className="max-w-[140px] truncate"
                title={tab.name}
              >
                {tab.name}
              </button>
            )}
            {!editing && (
              <div className="flex shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={`${tab.name} 복제`}
                  onClick={() => onDuplicate(tab.id)}
                  className="rounded p-1 hover:bg-background"
                >
                  <Copy className="h-3 w-3" />
                </button>
                {tabs.length > 1 && (
                  <button
                    type="button"
                    aria-label={`${tab.name} 삭제`}
                    onClick={() => onRemove(tab.id)}
                    className="rounded p-1 hover:bg-background"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onAdd}
        className="h-8 shrink-0 gap-1 text-muted-foreground"
      >
        <Plus className="h-3.5 w-3.5" /> 새 조합
      </Button>
    </div>
  )
}
