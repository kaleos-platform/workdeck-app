'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import type { PreviewTarget } from '@/lib/sh/coupang-price/build-targets'
import type { PriceRow } from '@/lib/sh/coupang-price/listing-derive'
import { SELLER_HUB_COUPANG_MATCHING_PATH } from '@/lib/deck-routes'
import { wingListingUrl } from '@/lib/coupang/wing-link'

import { CoupangItemPickerDialog } from './coupang-item-picker-dialog'

type JobView = {
  id: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED'
  results: Array<{ listingId: string; vendorItemId: string; ok: boolean; error: string | null }> | null
  error: string | null
  createdAt: string
  executedAt: string | null
  targets: Array<{ listingId: string; listingName: string; targetPrice: number; apMinSalePrice: number }>
}

const POLL_MS = 2_000
const POLL_LIMIT_MS = 3 * 60_000
const isDone = (s: JobView['status']) => s === 'SUCCEEDED' || s === 'PARTIAL' || s === 'FAILED'

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

function ageLabel(hours: number | null): string {
  if (hours == null) return '연결 안 됨'
  if (hours < 24) return `${hours}시간 전 기준`
  return `${Math.floor(hours / 24)}일 전 기준`
}

export type CoupangApplyTarget = {
  channelId: string
  channelName: string
  /** 대표 채널로 대체된 실제 리스팅 채널 id (로켓그로스는 representativeChannelId) */
  listingChannelId: string
  externalSource: string | null
  /** 가격시뮬 확정 행 — 행 2개 이상이면 세트 */
  rows: PriceRow[]
  /** 할인·프로모션 적용 전 판매가 */
  salePrice: number
  /** 최소허용마진 달성가 (자동조정 최저가) */
  minMarginPrice: number
  includeVat: boolean
  vatRate: number
  discountRate: number
  promotionLabel: string | null
  costPrice: number
  channelFeePct: number
  shippingCost: number
  /** 목표 마진율(0~1, 권장가 역산 기준) — rationale.targetMargin */
  targetMargin: number
  /** 최소허용마진율(0~1) — recommendedMin(자동조정 최저가)을 만든 기준. UI 라벨 전용 */
  minMarginPct: number
  computedMargin: number
}

type Props = {
  target: CoupangApplyTarget | null
  onOpenChange: (v: boolean) => void
}

type PreviewResponse = {
  targets: PreviewTarget[]
  ambiguous: Array<Array<{ id: string; name: string }>>
  /** 판매채널 상품이 하나도 없는 옵션 — 서버가 직접 계산해 준다 */
  unmatched: Array<{ id: string; name: string }>
}

export function CoupangPriceApplyDialog({ target, onOpenChange }: Props) {
  const open = target != null

  const [loading, setLoading] = useState(false)
  const [targets, setTargets] = useState<PreviewTarget[]>([])
  const [ambiguous, setAmbiguous] = useState<PreviewResponse['ambiguous']>([])
  const [unmatched, setUnmatched] = useState<PreviewResponse['unmatched']>([])
  const [pickerListing, setPickerListing] = useState<{ id: string; name: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const loadPreview = useMemo(
    () => async (t: CoupangApplyTarget) => {
      setLoading(true)
      try {
        const res = await fetch('/api/sh/coupang-price/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: t.channelId,
            rows: t.rows,
            salePrice: t.salePrice,
            minMarginPrice: t.minMarginPrice,
            includeVat: t.includeVat,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.message ?? data?.error ?? '미리보기 조회 실패')
        const preview = data as PreviewResponse
        setTargets(preview.targets)
        setAmbiguous(preview.ambiguous)
        setUnmatched(preview.unmatched ?? [])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '미리보기 조회 실패')
        setTargets([])
        setAmbiguous([])
        setUnmatched([])
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (target) {
      void loadPreview(target)
    } else {
      setTargets([])
      setAmbiguous([])
      setUnmatched([])
    }
  }, [target, loadPreview])

  const [job, setJob] = useState<JobView | null>(null)
  // 폴링 기준 시각(ms). 타임아웃 상태는 이 값에서 타이머로 만든다(렌더 중 Date.now() 금지).
  const [pollAnchor, setPollAnchor] = useState<number | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const [tick, setTick] = useState(0)

  const fetchLatestJob = useCallback(async (channelId: string): Promise<JobView | null> => {
    const res = await fetch(`/api/sh/coupang-price/jobs?channelId=${encodeURIComponent(channelId)}`)
    const data = await res.json().catch(() => ({}))
    return res.ok ? ((data as { job: JobView | null }).job ?? null) : null
  }, [])

  // 열 때 미리보기와 함께 이 채널의 최근 반영 결과를 불러온다(닫은 사이 끝난 결과 확인용).
  useEffect(() => {
    setTimedOut(false)
    if (!target) {
      setJob(null)
      setPollAnchor(null)
      return
    }
    let cancelled = false
    fetchLatestJob(target.channelId)
      .then((j) => {
        if (cancelled) return
        setJob(j)
        // 미완료 job 은 생성 시각 기준으로 3분을 센다.
        if (j && !isDone(j.status)) setPollAnchor(new Date(j.createdAt).getTime())
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [target, fetchLatestJob])

  const running = job != null && !isDone(job.status)

  // 3분 타임아웃(워커 중단 의심 안내). 이미 지났으면 즉시 발동.
  useEffect(() => {
    if (!running || pollAnchor == null) return
    const t = setTimeout(
      () => setTimedOut(true),
      Math.max(0, POLL_LIMIT_MS - (Date.now() - pollAnchor))
    )
    return () => clearTimeout(t)
  }, [running, pollAnchor])

  // 진행 중이면 2초 간격 폴링. 실패해도 타임아웃까지 계속 재시도한다.
  useEffect(() => {
    if (!target || !running || timedOut) return
    const t = setTimeout(async () => {
      try {
        const next = await fetchLatestJob(target.channelId)
        if (next) setJob(next)
        if (next && isDone(next.status)) void loadPreview(target)
      } catch {
        // 일시 오류 — 다음 틱에 재시도
      }
      setTick((n) => n + 1)
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [target, running, timedOut, tick, fetchLatestJob, loadPreview])

  async function handleSubmit() {
    if (!target) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/sh/coupang-price/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: target.channelId,
          rows: target.rows,
          salePrice: target.salePrice,
          minMarginPrice: target.minMarginPrice,
          includeVat: target.includeVat,
          // 서버가 다시 계산한 대상이 미리보기와 다르면 409 — 보지 못한 대상이 반영되지 않게.
          expectedListingIds: targets
            .filter((t) => t.blockedReason == null && t.vendorItemId != null)
            .map((t) => t.listingId),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data?.code === 'TARGETS_CHANGED') void loadPreview(target)
      if (!res.ok) throw new Error(data?.message ?? `반영 요청 실패 (HTTP ${res.status})`)
      // 201 본문으로 임시 job 을 즉시 보여주고, 이후는 폴링이 갱신한다.
      const jobId = (data as { job?: { id?: string } }).job?.id ?? ''
      setJob({
        id: jobId,
        status: 'PENDING',
        results: null,
        error: null,
        createdAt: new Date().toISOString(),
        executedAt: null,
        targets: targets
          .filter((t) => t.blockedReason == null)
          .map((t) => ({
            listingId: t.listingId,
            listingName: t.listingName,
            targetPrice: t.targetPrice,
            apMinSalePrice: t.apMinSalePrice,
          })),
      })
      setTimedOut(false)
      setPollAnchor(Date.now())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반영 요청 실패')
    } finally {
      setSubmitting(false)
    }
  }

  const pollTimedOut = running && timedOut
  const inFlight = running && !timedOut

  const writableCount = targets.filter((t) => t.blockedReason == null).length

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onOpenChange(false)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>쿠팡 판매가 반영</DialogTitle>
            <DialogDescription>
              {target?.channelName} 채널에 {target && target.rows.length > 1 ? '세트' : '옵션'} 가격을
              반영합니다. 확인하면 바로 쿠팡에 반영됩니다(보통 1분 안).
            </DialogDescription>
          </DialogHeader>

          {target && (target.discountRate > 0 || target.promotionLabel) && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                이 시나리오에는 할인 {(target.discountRate * 100).toFixed(0)}%
                {target.promotionLabel ? ` / 프로모션 ${target.promotionLabel}` : ''}가 있으나 쿠팡
                판매가에는 반영되지 않습니다. (판매가는 할인·프로모션 적용 전 기준)
              </p>
            </div>
          )}

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <span className="font-medium">자동 가격조정 켜짐</span>
            <span className="ml-2 text-muted-foreground">
              최저가는 최소마진 {target ? (target.minMarginPct * 100).toFixed(0) : 0}% 기준으로
              옵션마다 설정됩니다
            </span>
            <p className="mt-1 flex items-start gap-1 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              꺼져 있던 옵션도 자동조정이 켜지고, Wing 에서 정한 최저가는 아래 값으로 바뀝니다.
            </p>
          </div>

          {unmatched.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              판매채널 상품이 없어 반영할 수 없는 옵션 {unmatched.length}개:{' '}
              {unmatched.map((o) => o.name).join(', ')}
            </div>
          )}

          {ambiguous.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              같은 옵션에 판매채널 상품이 여러 개 매칭되어 자동으로 고를 수 없습니다:{' '}
              {ambiguous.map((g) => g.map((l) => l.name).join(' / ')).join(', ')}
            </div>
          )}

          <Link href={SELLER_HUB_COUPANG_MATCHING_PATH} className="text-xs text-muted-foreground underline">
            쿠팡 상품 매칭 관리
          </Link>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>리스팅명</TableHead>
                  <TableHead className="text-right">현재가</TableHead>
                  <TableHead className="text-right">목표가</TableHead>
                  <TableHead className="text-right">자동조정 최저가</TableHead>
                  <TableHead className="text-right">Δ%</TableHead>
                  <TableHead>스냅샷</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      불러오는 중...
                    </TableCell>
                  </TableRow>
                ) : targets.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      대상이 없습니다
                    </TableCell>
                  </TableRow>
                ) : (
                  targets.map((t) => (
                    <TableRow
                      key={t.listingId}
                      className={t.blockedReason ? 'opacity-60' : undefined}
                    >
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-1">
                          {t.listingName}
                          {t.sellerProductId && (
                            <a
                              href={wingListingUrl(t.sellerProductId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="쿠팡 Wing에서 보기"
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.currentPrice != null ? `₩${fmt(t.currentPrice)}` : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        ₩{fmt(t.targetPrice)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">₩{fmt(t.apMinSalePrice)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.deltaPct != null ? `${(t.deltaPct * 100).toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {ageLabel(t.snapshotAgeHours)}
                      </TableCell>
                      <TableCell>
                        {t.blockedReason ? (
                          <Badge
                            variant="outline"
                            className="border-destructive/40 text-destructive"
                          >
                            {t.blockedReason}
                          </Badge>
                        ) : t.vendorItemId == null ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() =>
                              setPickerListing({ id: t.listingId, name: t.listingName })
                            }
                          >
                            쿠팡 옵션 연결
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {job && (
            <div className="rounded-md border px-3 py-2 text-sm">
              <p className="font-medium">
                {inFlight
                  ? '쿠팡에 반영 중…'
                  : pollTimedOut
                    ? '워커가 아직 처리하지 않았습니다 — 워커가 멈췄을 수 있습니다'
                    : job.status === 'SUCCEEDED'
                      ? '최근 반영: 모두 성공'
                      : job.status === 'PARTIAL'
                        ? '최근 반영: 일부 실패'
                        : '최근 반영: 실패'}
                <span className="ml-2 text-xs text-muted-foreground">
                  {new Date(job.createdAt).toLocaleString('ko-KR')}
                </span>
              </p>
              {job.error && <p className="mt-1 text-xs text-destructive">{job.error}</p>}
              {job.results && (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {job.results.map((r) => {
                    const t = job.targets.find((x) => x.listingId === r.listingId)
                    return (
                      <li key={r.listingId} className={r.ok ? 'text-emerald-700' : 'text-destructive'}>
                        {t?.listingName ?? r.listingId} —{' '}
                        {r.ok ? `₩${fmt(t?.targetPrice ?? 0)} 반영` : `실패: ${r.error ?? '알 수 없음'}`}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              취소
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || loading || inFlight || writableCount === 0}>
              {submitting ? '요청 중...' : inFlight ? '반영 중...' : `쿠팡에 반영 (${writableCount}개)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pickerListing && (
        <CoupangItemPickerDialog
          open={!!pickerListing}
          onOpenChange={(v) => !v && setPickerListing(null)}
          listingId={pickerListing.id}
          listingName={pickerListing.name}
          onLinked={() => {
            setPickerListing(null)
            if (target) void loadPreview(target)
          }}
        />
      )}
    </>
  )
}
