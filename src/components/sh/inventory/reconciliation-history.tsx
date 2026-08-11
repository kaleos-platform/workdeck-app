'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Trash2 } from 'lucide-react'
import { reconStatusBadge, type ReconStatus } from './recon-status-display'

type HistoryRow = {
  id: string
  fileName: string
  snapshotDate: string
  status: ReconStatus
  totalItems: number
  matchedItems: number
  adjustedItems: number
  createdAt: string
  confirmedAt: string | null
  location: { id: string; name: string }
}

type Props = {
  refreshKey: number
  onSelect: (id: string) => void
  selectedId?: string | null
  /** 열려 있던 대조가 삭제됐을 때 상세 패널을 닫기 위해 호출 */
  onDeleted?: (id: string) => void
}

export function ReconciliationHistory({ refreshKey, onSelect, selectedId, onDeleted }: Props) {
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sh/inventory/reconciliation')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '조회 실패')
      setRows(data.data ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function handleDelete(row: HistoryRow) {
    const lines = ['이 대조 기록을 삭제할까요?']
    if (row.adjustedItems > 0) {
      lines.push(`이미 반영된 재고 조정 ${row.adjustedItems}건은 되돌아가지 않습니다.`)
    }
    if (!confirm(lines.join('\n'))) return

    setDeletingId(row.id)
    try {
      const res = await fetch(`/api/sh/inventory/reconciliation/${row.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message ?? '삭제 실패')
      toast.success('삭제되었습니다')
      onDeleted?.(row.id)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex h-16 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        대조 기록이 없습니다
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {rows.map((r) => (
        // 삭제 버튼이 안에 들어가므로 button 중첩을 피해 div + role 로 둔다.
        <div
          key={r.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(r.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(r.id)
            }
          }}
          className={`group w-full cursor-pointer rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-accent ${
            selectedId === r.id ? 'border-primary/30 bg-accent' : 'border-transparent'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.fileName}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {r.location.name} · {new Date(r.snapshotDate).toISOString().slice(0, 10)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                총 {r.totalItems} / 매칭 {r.matchedItems} / 조정 {r.adjustedItems}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {reconStatusBadge(r.status)}
              {/* 확정된 대조는 감사 기록이므로 삭제 불가 */}
              {r.status !== 'CONFIRMED' && (
                <button
                  type="button"
                  aria-label="삭제"
                  disabled={deletingId === r.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleDelete(r)
                  }}
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus:opacity-100"
                >
                  {deletingId === r.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
