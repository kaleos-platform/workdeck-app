'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

type HistoryRow = {
  id: string
  fileName: string
  snapshotDate: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED'
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
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: '대기',
  CONFIRMED: '확정',
  CANCELLED: '취소',
}

export function ReconciliationHistory({ refreshKey, onSelect, selectedId }: Props) {
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/inv/reconciliation')
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
      <p className="px-1 pb-2 text-xs font-medium text-muted-foreground">파일 내역</p>
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onSelect(r.id)}
          className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-accent ${
            selectedId === r.id ? 'bg-accent border-primary/30' : 'border-transparent'
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
            <Badge
              variant={
                r.status === 'CONFIRMED' ? 'default' : r.status === 'CANCELLED' ? 'destructive' : 'secondary'
              }
              className="shrink-0 text-[10px]"
            >
              {STATUS_LABEL[r.status] ?? r.status}
            </Badge>
          </div>
        </button>
      ))}
    </div>
  )
}
