'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loader2, Play, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

type CollectionRunStatus = 'COMPLETED' | 'FAILED' | 'RUNNING' | 'PENDING' | 'DOWNLOADING' | 'PARSING'

type CollectionRun = {
  id: string
  status: CollectionRunStatus
  triggeredBy: string
  startedAt: string | null
  completedAt: string | null
  error: string | null
  createdAt: string
}

const STATUS_CONFIG: Record<
  CollectionRunStatus,
  { label: string; className: string }
> = {
  COMPLETED: {
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
  DOWNLOADING: {
    label: '다운로드 중',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  },
  PARSING: {
    label: '파싱 중',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  },
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: '수동',
  scheduled: '자동',
  api: 'API',
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}초`
  const minutes = Math.floor(seconds / 60)
  const remainSeconds = seconds % 60
  return `${minutes}분 ${remainSeconds}초`
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

const ACTIVE_STATUSES = ['PENDING', 'RUNNING', 'DOWNLOADING', 'PARSING']

export function CollectionHistory() {
  const [runs, setRuns] = useState<CollectionRun[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isTriggering, setIsTriggering] = useState(false)

  // 진행 중인 작업 확인
  const activeRun = runs.find((r) => ACTIVE_STATUSES.includes(r.status))
  const hasActiveRun = Boolean(activeRun)

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/collection/runs')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRuns(Array.isArray(data) ? data : data.runs ?? [])
    } catch {
      // 조용히 실패
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRuns()
  }, [fetchRuns])

  // 진행 중인 작업이 있으면 5초마다 자동 새로고침
  useEffect(() => {
    if (!hasActiveRun) return
    const interval = setInterval(fetchRuns, 5000)
    return () => clearInterval(interval)
  }, [hasActiveRun, fetchRuns])

  async function handleManualTrigger() {
    setIsTriggering(true)
    try {
      const res = await fetch('/api/collection/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const message = (data as { message?: string }).message ?? '수동 수집 시작에 실패했습니다'
        toast.error(message)
        return
      }

      toast.success('수동 수집이 시작되었습니다')
      await fetchRuns()
    } catch {
      toast.error('수동 수집 시작 중 오류가 발생했습니다')
    } finally {
      setIsTriggering(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>수집 이력</CardTitle>
            <CardDescription>
              최근 데이터 수집 실행 기록을 확인합니다.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchRuns}
              disabled={isLoading}
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
              새로고침
            </Button>
            <Button
              size="sm"
              onClick={handleManualTrigger}
              disabled={isTriggering || hasActiveRun}
            >
              {isTriggering ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  수집 시작 중...
                </>
              ) : hasActiveRun ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  수집 진행 중...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  수동 수집
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : runs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            수집 이력이 없습니다
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>날짜</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>트리거</TableHead>
                  <TableHead>시작시간</TableHead>
                  <TableHead>소요시간</TableHead>
                  <TableHead>에러</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">
                      {formatDate(run.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          STATUS_CONFIG[run.status as CollectionRunStatus]?.className
                        )}
                      >
                        {STATUS_CONFIG[run.status as CollectionRunStatus]?.label ?? run.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {TRIGGER_LABELS[run.triggeredBy] ?? run.triggeredBy}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {run.startedAt ? formatDateTime(run.startedAt) : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {run.startedAt && run.completedAt
                        ? formatDuration(new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())
                        : '-'}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      {run.error ? (
                        <span className="truncate text-sm text-destructive" title={run.error}>
                          {run.error}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
