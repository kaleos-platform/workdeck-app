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

function toDateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

function getDefaultDates() {
  const now = new Date()
  return {
    from: toDateStr(new Date(now.getTime() - 7 * 86400000)),
    to: toDateStr(now),
  }
}

export function BatchList({ onSelect, selectedBatchId }: BatchListProps) {
  const [batches, setBatches] = useState<Batch[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  // 기본 7일
  const defaults = getDefaultDates()
  const [dateFrom, setDateFrom] = useState(defaults.from)
  const [dateTo, setDateTo] = useState(defaults.to)
  const [activePreset, setActivePreset] = useState<string>('7d')

  const fetchBatches = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        status: 'COMPLETED',
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      const res = await fetch(`/api/sh/shipping/batches?${params}`)
      if (!res.ok) throw new Error('배송 묶음 목록 조회 실패')
      const json = await res.json()
      setBatches(json.data)
      setTotal(json.total)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '배송 묶음 목록 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    fetchBatches()
  }, [fetchBatches])

  // 기간 프리셋
  function applyPreset(preset: string) {
    const now = new Date()
    let from: Date
    let to: Date = now

    switch (preset) {
      case '7d':
        from = new Date(now.getTime() - 7 * 86400000)
        break
      case '30d':
        from = new Date(now.getTime() - 30 * 86400000)
        break
      case 'thisMonth':
        from = new Date(now.getFullYear(), now.getMonth(), 1)
        break
      case 'lastMonth':
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        to = new Date(now.getFullYear(), now.getMonth(), 0)
        break
      default:
        return
    }
    setDateFrom(toDateStr(from))
    setDateTo(toDateStr(to))
    setActivePreset(preset)
  }

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

  const presets = [
    { key: '7d', label: '7일' },
    { key: '30d', label: '30일' },
    { key: 'thisMonth', label: '이번달' },
    { key: 'lastMonth', label: '지난달' },
  ]

  return (
    <div className="space-y-3">
      {/* 필터 바: 제목 · 프리셋 · 날짜 · 페이지네이션 한 줄 */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="shrink-0 text-sm font-semibold">완료된 배송 묶음</h2>

        <div className="flex gap-1">
          {presets.map((p) => (
            <Button
              key={p.key}
              variant={activePreset === p.key ? 'default' : 'outline'}
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => applyPreset(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value)
              setActivePreset('')
            }}
            className="h-8 w-36 text-xs"
            placeholder="시작일"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value)
              setActivePreset('')
            }}
            className="h-8 w-36 text-xs"
            placeholder="종료일"
          />
        </div>

        {totalPages > 1 && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
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
              className="h-8"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </Button>
          </div>
        )}
      </div>

      {/* 배송 묶음 테이블 */}
      <div className="max-h-[220px] overflow-y-auto rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
            <TableRow>
              <TableHead className="text-xs">날짜</TableHead>
              <TableHead className="text-xs">라벨</TableHead>
              <TableHead className="text-right text-xs">주문 수</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-xs text-muted-foreground">
                  로딩 중...
                </TableCell>
              </TableRow>
            ) : filteredBatches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-xs text-muted-foreground">
                  완료된 배송 묶음이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              filteredBatches.map((batch) => (
                <TableRow
                  key={batch.id}
                  className={`cursor-pointer transition-colors ${
                    selectedBatchId === batch.id ? 'bg-primary/10' : 'hover:bg-muted/50'
                  }`}
                  onClick={() => onSelect(batch.id)}
                >
                  <TableCell className="text-xs">{formatDate(batch.createdAt)}</TableCell>
                  <TableCell className="text-xs">
                    {batch.label || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-right text-xs">
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
    </div>
  )
}
