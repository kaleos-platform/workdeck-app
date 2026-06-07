'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Database, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── 타입 ────────────────────────────────────────────────────────────────────

type BackfillStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED'

type BackfillJob = {
  id: string
  days: number
  trigger: string // 'backfill' | 'scheduled'
  status: BackfillStatus
  claimedAt: string | null
  completedAt: string | null
  collected: number
  converted: number
  duplicateRows: number
  outboundCount: number
  revenueSum: string | number
  orderSum: number
  salesQtySum: number
  error: string | null
  createdAt: string
}

type ListResponse = {
  jobs: BackfillJob[]
  hasVendorData: boolean
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5000
const DEFAULT_DAYS = 90
const ACTIVE_STATUSES: BackfillStatus[] = ['PENDING', 'RUNNING']

const STATUS_CONFIG: Record<BackfillStatus, { label: string; className: string }> = {
  DONE: {
    label: '완료',
    className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  },
  FAILED: {
    label: '실패',
    className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  },
  RUNNING: {
    label: '실행 중',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  },
  PENDING: {
    label: '대기',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  },
  CANCELLED: {
    label: '취소됨',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  },
}

const TRIGGER_CONFIG: Record<string, { label: string; className: string }> = {
  backfill: {
    label: '백필',
    className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  },
  scheduled: {
    label: '자동',
    className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  },
  manual: {
    label: '수동',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  },
}

// ─── 포맷 ─────────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}초`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}분 ${seconds % 60}초`
}

function won(v: string | number): string {
  const n = typeof v === 'string' ? Number(v) : v
  if (!Number.isFinite(n)) return '-'
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function SalesCollectionHistory() {
  const [jobs, setJobs] = useState<BackfillJob[]>([])
  const [hasVendorData, setHasVendorData] = useState(false)
  const [loading, setLoading] = useState(true)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [daysInput, setDaysInput] = useState(String(DEFAULT_DAYS))
  const [submitting, setSubmitting] = useState(false)

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const hasActiveJob = jobs.some((j) => ACTIVE_STATUSES.includes(j.status))

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/collection/backfill?list=true')
      if (!res.ok) return
      const data = (await res.json()) as ListResponse
      setJobs(Array.isArray(data.jobs) ? data.jobs : [])
      setHasVendorData(Boolean(data.hasVendorData))
    } catch {
      // 조용히 실패
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchJobs()
  }, [fetchJobs])

  // 진행 중 잡이 있으면 폴링
  useEffect(() => {
    if (hasActiveJob) {
      pollTimerRef.current = setInterval(fetchJobs, POLL_INTERVAL_MS)
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [hasActiveJob, fetchJobs])

  async function handleSubmit() {
    const days = parseInt(daysInput, 10)
    if (!Number.isInteger(days) || days < 1 || days > 120) {
      toast.error('일수는 1~120 사이의 정수를 입력해 주세요')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/collection/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) {
        toast.info('이미 진행 중인 수집 작업이 있습니다.')
        setDialogOpen(false)
        await fetchJobs()
        return
      }
      if (!res.ok) throw new Error((data as { message?: string }).message ?? '수집 시작 실패')
      toast.success(`${days}일치 판매 데이터 수집을 시작했습니다`)
      setDialogOpen(false)
      await fetchJobs()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '수집 시작 실패')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel() {
    try {
      const res = await fetch('/api/collection/backfill', { method: 'DELETE' })
      if (res.status === 404) {
        toast.info('취소할 진행 중인 작업이 없습니다.')
      } else if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { message?: string }).message ?? '취소 실패')
      } else {
        toast.success('수집 작업을 취소했습니다.')
      }
      await fetchJobs()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '취소 실패')
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>판매 데이터 수집 이력</CardTitle>
              <CardDescription>
                쿠팡 로켓그로스 판매(VENDOR) 수집·변환 실행 기록을 확인합니다.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {hasActiveJob ? (
                <Button size="sm" variant="destructive" onClick={handleCancel}>
                  수집 취소
                </Button>
              ) : (
                <Button size="sm" onClick={() => setDialogOpen(true)}>
                  <Database className="mr-2 h-4 w-4" />
                  과거 데이터 수집
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              수집 이력이 없습니다. &ldquo;과거 데이터 수집&rdquo;으로 시작하세요.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>날짜</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>유형</TableHead>
                    <TableHead>기간</TableHead>
                    <TableHead>소요시간</TableHead>
                    <TableHead className="text-right">매출</TableHead>
                    <TableHead className="text-right">주문</TableHead>
                    <TableHead className="text-right">판매량</TableHead>
                    <TableHead className="text-right">재고차감</TableHead>
                    <TableHead>결과</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => {
                    const duration =
                      job.claimedAt && job.completedAt
                        ? formatDuration(
                            new Date(job.completedAt).getTime() - new Date(job.claimedAt).getTime()
                          )
                        : '-'
                    return (
                      <TableRow key={job.id}>
                        <TableCell className="font-medium">{formatDate(job.createdAt)}</TableCell>
                        <TableCell>
                          <Badge className={cn(STATUS_CONFIG[job.status]?.className)}>
                            {STATUS_CONFIG[job.status]?.label ?? job.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={cn('text-[10px]', TRIGGER_CONFIG[job.trigger]?.className)}
                          >
                            {TRIGGER_CONFIG[job.trigger]?.label ?? job.trigger}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{job.days}일</TableCell>
                        <TableCell className="text-muted-foreground">{duration}</TableCell>
                        <TableCell className="text-right">{won(job.revenueSum)}</TableCell>
                        <TableCell className="text-right">
                          {(job.orderSum ?? 0).toLocaleString()}건
                        </TableCell>
                        <TableCell className="text-right">
                          {(job.salesQtySum ?? 0).toLocaleString()}개
                        </TableCell>
                        <TableCell className="text-right">
                          {(job.outboundCount ?? 0).toLocaleString()}건
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          {job.error ? (
                            <span className="truncate text-sm text-destructive" title={job.error}>
                              {job.error}
                            </span>
                          ) : ACTIVE_STATUSES.includes(job.status) ? (
                            <span className="text-sm text-muted-foreground">진행 중...</span>
                          ) : job.status === 'DONE' ? (
                            <span className="text-sm text-muted-foreground">
                              수집 {job.collected}일
                              {job.duplicateRows > 0 && (
                                <span className="text-muted-foreground">
                                  {' '}
                                  · 중복 {job.duplicateRows.toLocaleString()}건
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 과거 데이터 수집 다이얼로그 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>과거 판매 데이터 수집</DialogTitle>
            <DialogDescription>
              수집할 과거 일수를 입력하세요. 최대 120일까지 지원합니다.
              {hasVendorData && ' 이미 수집된 날짜는 중복으로 처리되어 최신 값으로 갱신됩니다.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="sales-backfill-days">수집 일수 (1~120)</Label>
            <Input
              id="sales-backfill-days"
              type="number"
              min={1}
              max={120}
              value={daysInput}
              onChange={(e) => setDaysInput(e.target.value)}
              disabled={submitting}
              placeholder="90"
            />
            <p className="text-xs text-muted-foreground">
              쿠팡 VENDOR 판매 데이터를 수집합니다. 기간이 길수록 시간이 오래 걸립니다.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              취소
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  시작 중...
                </>
              ) : (
                '수집 시작'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
