'use client'

import { useCallback, useEffect, useRef, useState, type Ref } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  source: string
  createdAt: string
  completedAt: string | null
}

interface BatchListProps {
  dateFrom: string
  dateTo: string
  onSelect: (batchId: string | null) => void
  selectedBatchId?: string | null
  onCollapse?: () => void
  collapseButtonRef?: Ref<HTMLButtonElement>
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function BatchList({
  dateFrom,
  dateTo,
  onSelect,
  selectedBatchId,
  onCollapse,
  collapseButtonRef,
}: BatchListProps) {
  const [batches, setBatches] = useState<Batch[]>([])
  const [loadedRange, setLoadedRange] = useState('')
  const [loading, setLoading] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const requestId = useRef(0)

  const range = `${dateFrom}|${dateTo}`

  // 삭제 확인 다이얼로그 (라벨 타이핑 확인으로 실수 방지)
  const [deleteTarget, setDeleteTarget] = useState<Batch | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const fetchBatches = useCallback(async () => {
    const currentRequest = ++requestId.current
    setLoading(true)
    try {
      const params = new URLSearchParams({
        status: 'COMPLETED',
        from: dateFrom,
        to: dateTo,
      })
      const res = await fetch(`/api/sh/shipping/batches?${params}`)
      if (!res.ok) throw new Error('배송 묶음 목록 조회 실패')
      const json = await res.json()
      if (currentRequest !== requestId.current) return
      setBatches(json.data)
      setLoadedRange(`${dateFrom}|${dateTo}`)
    } catch (err) {
      if (currentRequest === requestId.current) {
        setBatches([])
        setLoadedRange(`${dateFrom}|${dateTo}`)
        toast.error(err instanceof Error ? err.message : '배송 묶음 목록 조회 실패')
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    fetchBatches()
  }, [fetchBatches, refreshVersion])

  useEffect(() => {
    if (
      loadedRange === range &&
      selectedBatchId &&
      !batches.some((b) => b.id === selectedBatchId)
    ) {
      onSelect(null)
    }
  }, [batches, loadedRange, onSelect, range, selectedBatchId])

  // 삭제 확인 라벨 — label 없으면 날짜로 대체
  const deleteConfirmLabel = deleteTarget
    ? deleteTarget.label || formatDate(deleteTarget.completedAt ?? deleteTarget.createdAt)
    : ''

  async function handleDelete() {
    if (!deleteTarget || confirmText.trim() !== deleteConfirmLabel) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/sh/shipping/batches/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || '배송 묶음 삭제 실패')
      }
      const json = await res.json().catch(() => ({}))
      toast.success(
        `배송 묶음을 삭제했습니다${json.deletedMovements ? ` (재고이력 ${json.deletedMovements}건 포함)` : ''}`
      )
      setDeleteTarget(null)
      setConfirmText('')
      setRefreshVersion((version) => version + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '배송 묶음 삭제 실패')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="shrink-0 text-sm font-semibold">완료된 배송 묶음</h2>
        {onCollapse && (
          <Button
            ref={collapseButtonRef}
            variant="ghost"
            size="icon"
            className="hidden h-7 w-7 2xl:inline-flex"
            onClick={onCollapse}
            aria-label="배송 묶음 접기"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* 배송 묶음 테이블 */}
      <div className="max-h-[220px] overflow-y-auto rounded-md border 2xl:max-h-[calc(100vh-260px)]">
        <Table className="table-fixed">
          <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
            <TableRow>
              <TableHead className="min-w-0 text-xs">배송 묶음</TableHead>
              <TableHead className="w-14 text-right text-xs">주문 수</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-xs text-muted-foreground">
                  로딩 중...
                </TableCell>
              </TableRow>
            ) : batches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-xs text-muted-foreground">
                  완료된 배송 묶음이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              batches.map((batch) => (
                <TableRow
                  key={batch.id}
                  className={`cursor-pointer transition-colors ${
                    selectedBatchId === batch.id ? 'bg-primary/10' : 'hover:bg-muted/50'
                  }`}
                  onClick={() => onSelect(batch.id)}
                >
                  <TableCell className="min-w-0 text-xs">
                    <span className="block truncate text-muted-foreground">
                      {formatDate(batch.completedAt ?? batch.createdAt)}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      {batch.source === 'IMPORT' && (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-300 bg-amber-50 text-[10px] text-amber-700"
                        >
                          이전
                        </Badge>
                      )}
                      <span className="block min-w-0 truncate" title={batch.label ?? undefined}>
                        {batch.label || <span className="text-muted-foreground">-</span>}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <Badge variant="secondary" className="text-xs">
                      {batch.orderCount}
                    </Badge>
                  </TableCell>
                  <TableCell className="p-1 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteTarget(batch)
                        setConfirmText('')
                      }}
                      aria-label="배송 묶음 삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 삭제 확인 — 라벨 타이핑 확인 */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setConfirmText('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>배송 묶음 삭제</DialogTitle>
            <DialogDescription>
              이 작업은 되돌릴 수 없습니다. 묶음의 주문 {deleteTarget?.orderCount ?? 0}건
              {deleteTarget?.source === 'IMPORT' ? ' 과 연동된 재고 이력' : ''}이 함께 삭제됩니다.
              <br />
              계속하려면 라벨{' '}
              <span className="font-semibold text-foreground">{deleteConfirmLabel}</span> 을(를)
              입력하세요.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={deleteConfirmLabel}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null)
                setConfirmText('')
              }}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={deleting || confirmText.trim() !== deleteConfirmLabel}
              onClick={handleDelete}
            >
              {deleting ? '삭제 중…' : '삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
