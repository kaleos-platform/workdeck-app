'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

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
}

export function ReconciliationHistory({ refreshKey, onSelect }: Props) {
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
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        아직 대조 기록이 없습니다. 파일을 업로드해서 시작하세요.
      </div>
    )
  }

  return (
    <div className="rounded-md border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>파일명</TableHead>
            <TableHead>보관 장소</TableHead>
            <TableHead>기준일</TableHead>
            <TableHead>상태</TableHead>
            <TableHead className="text-right">총/매칭/조정</TableHead>
            <TableHead>생성일</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.id}
              className="cursor-pointer"
              onClick={() => onSelect(r.id)}
            >
              <TableCell className="font-medium">{r.fileName}</TableCell>
              <TableCell>{r.location.name}</TableCell>
              <TableCell>
                {new Date(r.snapshotDate).toISOString().slice(0, 10)}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    r.status === 'CONFIRMED'
                      ? 'default'
                      : r.status === 'CANCELLED'
                        ? 'destructive'
                        : 'secondary'
                  }
                >
                  {r.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {r.totalItems} / {r.matchedItems} / {r.adjustedItems}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleString('ko-KR')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
