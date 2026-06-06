'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Database, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

// ─── 타입 ────────────────────────────────────────────────────────────────────

type BackfillJob = {
  id: string
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED'
  days: number
  collected: number | null
  converted: number | null
  error: string | null
}

type BackfillStatus = {
  job: BackfillJob | null
  hasVendorData: boolean
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5000
const DEFAULT_DAYS = 90

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function BackfillPrompt() {
  const [status, setStatus] = useState<BackfillStatus | null>(null)
  const [loading, setLoading] = useState(true)

  // 다이얼로그 상태
  const [dialogOpen, setDialogOpen] = useState(false)
  const [daysInput, setDaysInput] = useState(String(DEFAULT_DAYS))
  const [submitting, setSubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  // 배너 dismiss (세션 내 임시 숨김)
  const [dismissed, setDismissed] = useState(false)

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── 상태 조회 ──

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/collection/backfill')
      if (!res.ok) return
      const data = (await res.json()) as BackfillStatus
      setStatus(data)
    } catch {
      // 조용히 실패 — 백필 기능은 선택적
    } finally {
      setLoading(false)
    }
  }, [])

  // ── 폴링 ──

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const schedulePolling = useCallback(() => {
    stopPolling()
    pollTimerRef.current = setTimeout(async () => {
      await fetchStatus()
    }, POLL_INTERVAL_MS)
  }, [fetchStatus, stopPolling])

  useEffect(() => {
    void fetchStatus()
    return () => stopPolling()
  }, [fetchStatus, stopPolling])

  // 잡이 활성 상태(PENDING|RUNNING)면 폴링 지속
  useEffect(() => {
    const job = status?.job
    if (job && (job.status === 'PENDING' || job.status === 'RUNNING')) {
      schedulePolling()
    } else {
      stopPolling()
    }
  }, [status, schedulePolling, stopPolling])

  // ── 백필 시작 ──

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
      const data = await res.json()

      if (res.status === 409) {
        // 이미 진행 중 — 해당 잡 폴링 시작
        toast.info('이미 진행 중인 백필 잡이 있습니다. 진행 상황을 표시합니다.')
        setDialogOpen(false)
        await fetchStatus()
        return
      }

      if (!res.ok) {
        throw new Error(data?.message ?? '백필 시작 실패')
      }

      toast.success(`${days}일치 판매 데이터 수집을 시작했습니다`)
      setDialogOpen(false)
      // 새 잡 상태 반영
      setStatus((prev) => ({
        hasVendorData: prev?.hasVendorData ?? false,
        job: data.job as BackfillJob,
      }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '백필 시작 실패')
    } finally {
      setSubmitting(false)
    }
  }

  // ── 백필 취소 ──

  async function handleCancel() {
    setCancelling(true)
    try {
      const res = await fetch('/api/collection/backfill', { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))

      if (res.status === 404) {
        // 이미 끝났거나 취소된 잡 — 최신 상태로 갱신
        toast.info('취소할 진행 중인 작업이 없습니다.')
        await fetchStatus()
        return
      }
      if (!res.ok) {
        throw new Error(data?.message ?? '취소 실패')
      }

      toast.success('백필 작업을 취소했습니다.')
      // 진행 중이던 잡을 CANCELLED 로 즉시 반영 (워커는 RUNNING 시 날짜 루프 사이 종료)
      setStatus((prev) =>
        prev?.job ? { ...prev, job: { ...prev.job, status: 'CANCELLED' } } : prev
      )
      await fetchStatus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '취소 실패')
    } finally {
      setCancelling(false)
    }
  }

  // ── 렌더 조건 ──

  if (loading || !status) return null

  const { job, hasVendorData } = status
  const isActive = job && (job.status === 'PENDING' || job.status === 'RUNNING')
  const isDone = job?.status === 'DONE'
  const isFailed = job?.status === 'FAILED'
  const isCancelled = job?.status === 'CANCELLED'

  // 배너 노출 조건: 데이터 없음 OR 잡 진행 중/완료/실패/취소
  const showBanner = !hasVendorData || isActive || isDone || isFailed || isCancelled

  if (!showBanner || dismissed) return null

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── 배너 ── */}
      <div className="rounded-lg border bg-muted/40 p-4">
        {/* 콜드스타트 — 데이터 없고 잡 없음 */}
        {!hasVendorData && !isActive && !isDone && !isFailed && !isCancelled && (
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Database className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">과거 판매 데이터가 없습니다</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  과거 N일치 VENDOR 판매 데이터를 수집하면 재고·발주 예측 정확도가 높아집니다.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                과거 데이터 수집
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
                닫기
              </Button>
            </div>
          </div>
        )}

        {/* 진행 중 */}
        {isActive && (
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {job.status === 'PENDING' ? '백필 대기 중...' : `${job.days}일치 데이터 수집 중`}
              </p>
              {job.status === 'RUNNING' && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  수집 {job.collected ?? 0}건 · 변환 {job.converted ?? 0}건
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  취소 중...
                </>
              ) : (
                '취소'
              )}
            </Button>
          </div>
        )}

        {/* 완료 */}
        {isDone && (
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-800">백필 완료</AlertTitle>
            <AlertDescription className="text-green-700">
              {job.days}일치 판매 데이터를 수집했습니다. 수집 {job.collected ?? 0}건 · 변환{' '}
              {job.converted ?? 0}건
            </AlertDescription>
          </Alert>
        )}

        {/* 실패 */}
        {isFailed && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>백필 실패</AlertTitle>
            <AlertDescription>
              <span>{job.error ?? '알 수 없는 오류가 발생했습니다.'}</span>
              <Button
                size="sm"
                variant="outline"
                className="ml-3"
                onClick={() => setDialogOpen(true)}
              >
                다시 시도
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* 취소됨 */}
        {isCancelled && (
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">백필 작업이 취소되었습니다</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  수집 {job.collected ?? 0}건까지 진행 후 중단되었습니다. 다시 시작할 수 있습니다.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                다시 시작
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
                닫기
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── 백필 시작 다이얼로그 ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>과거 판매 데이터 수집</DialogTitle>
            <DialogDescription>
              수집할 과거 일수를 입력하세요. 최대 120일까지 지원합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="backfill-days">수집 일수 (1~120)</Label>
            <Input
              id="backfill-days"
              type="number"
              min={1}
              max={120}
              value={daysInput}
              onChange={(e) => setDaysInput(e.target.value)}
              disabled={submitting}
              placeholder="90"
            />
            <p className="text-xs text-muted-foreground">
              쿠팡 VENDOR 판매 데이터를 수집합니다. 수집 기간이 길수록 시간이 오래 걸릴 수 있습니다.
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
