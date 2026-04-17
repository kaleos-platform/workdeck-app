'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Batch {
  id: string
  label: string | null
  orderCount: number
  status: string
  createdAt: string
  completedAt: string | null
}

interface BatchListProps {
  onSelect: (batchId: string) => void
  selectedBatchId?: string | null
}

const PAGE_SIZE = 20

export function BatchList({ onSelect, selectedBatchId }: BatchListProps) {
  const [batches, setBatches] = useState<Batch[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  // 날짜 필터
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchBatches = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        status: 'COMPLETED',
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      const res = await fetch(`/api/del/batches?${params}`)
      if (!res.ok) throw new Error('배치 목록 조회 실패')
      const json = await res.json()
      setBatches(json.data)
      setTotal(json.total)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '배치 목록 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    fetchBatches()
  }, [fetchBatches])

  // 날짜 필터 적용 (클라이언트 사이드)
  const filteredBatches = batches.filter((b) => {
    if (dateFrom) {
      const from = new Date(dateFrom)
      if (new Date(b.createdAt) < from) return false
    }
    if (dateTo) {
      const to = new Date(dateTo)
      to.setHours(23, 59, 59, 999)
      if (new Date(b.createdAt) > to) return false
    }
    return true
  })

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">완료된 배치</h2>

      {/* 날짜 필터 */}
      <div className="flex gap-2">
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="text-xs"
          placeholder="시작일"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="text-xs"
          placeholder="종료일"
        />
      </div>

      {/* 배치 테이블 */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">날짜</TableHead>
              <TableHead className="text-xs">라벨</TableHead>
              <TableHead className="text-xs text-right">주문 수</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-8">
                  로딩 중...
                </TableCell>
              </TableRow>
            ) : filteredBatches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-8">
                  완료된 배치가 없습니다
                </TableCell>
              </TableRow>
            ) : (
              filteredBatches.map((batch) => (
                <TableRow
                  key={batch.id}
                  className={`cursor-pointer transition-colors ${
                    selectedBatchId === batch.id
                      ? 'bg-primary/10'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => onSelect(batch.id)}
                >
                  <TableCell className="text-xs">{formatDate(batch.createdAt)}</TableCell>
                  <TableCell className="text-xs">
                    {batch.label || (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    <Badge variant="secondary" className="text-xs">
                      {batch.orderCount}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            이전
          </Button>
          <span className="text-xs text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            다음
          </Button>
        </div>
      )}
    </div>
  )
}
