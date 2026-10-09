'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { ceilMinPriceTo10, roundPriceTo10 } from '@/lib/sh/coupang-price/price-round'
import type { PriceRow } from '@/lib/sh/coupang-price/listing-derive'
import { SELLER_HUB_COUPANG_MATCHING_PATH } from '@/lib/deck-routes'
import { wingListingUrl } from '@/lib/coupang/wing-link'

import { CoupangItemPickerDialog } from './coupang-item-picker-dialog'

type JobView = {
  id: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED'
  results: Array<{
    listingId: string
    vendorItemId: string
    ok: boolean
    error: string | null
  }> | null
  error: string | null
  createdAt: string
  executedAt: string | null
  targets: Array<{
    listingId: string
    listingName: string
    targetPrice: number
    apMinSalePrice: number
  }>
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
  // 팝업 안에서 고치는 판매가·자동조정 최저가 — 기본값은 시뮬 판매가·최소마진 가격(10원 단위).
  // 고쳐도 시뮬 화면 값은 바뀌지 않는다(이 반영에만 쓰인다).
  const [price, setPrice] = useState(0)
  const [floor, setFloor] = useState(0)

  const loadPreview = useMemo(
    () => async (t: CoupangApplyTarget, salePrice: number, minMarginPrice: number) => {
      setLoading(true)
      try {
        const res = await fetch('/api/sh/coupang-price/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: t.channelId,
            rows: t.rows,
            salePrice,
            minMarginPrice,
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

  // 열 때 시뮬 값으로 초기화
  useEffect(() => {
    if (target) {
      setPrice(roundPriceTo10(target.salePrice))
      setFloor(ceilMinPriceTo10(target.minMarginPrice))
    } else {
      setTargets([])
      setAmbiguous([])
      setUnmatched([])
    }
  }, [target])

  // 가격을 고치면 잠시 뒤 미리보기를 다시 계산한다(서버가 같은 규칙으로 판정).
  useEffect(() => {
    if (!target || price <= 0 || floor <= 0) return
    const t = setTimeout(() => void loadPreview(target, price, floor), 400)
    return () => clearTimeout(t)
  }, [target, price, floor, loadPreview])

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
        if (next && isDone(next.status)) void loadPreview(target, price, floor)
      } catch {
        // 일시 오류 — 다음 틱에 재시도
      }
      setTick((n) => n + 1)
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [target, running, timedOut, tick, fetchLatestJob, loadPreview, price, floor])

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
          salePrice: price,
          minMarginPrice: floor,
          includeVat: target.includeVat,
          // 서버가 다시 계산한 대상이 미리보기와 다르면 409 — 보지 못한 대상이 반영되지 않게.
          expectedListingIds: targets
            .filter((t) => t.blockedReason == null && t.vendorItemId != null)
            .map((t) => t.listingId),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data?.code === 'TARGETS_CHANGED')
        void loadPreview(target, price, floor)
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
  const unlinkedCount = targets.filter((t) => t.vendorItemId == null).length
  // 쿠팡 규칙: 자동조정 최저가 < 판매가. 화면 값은 서버와 같은 10원 규칙으로 맞춰 비교한다.
  const priceR = roundPriceTo10(price)
  const floorR = ceilMinPriceTo10(floor)
  const floorTooHigh = priceR > 0 && floorR >= priceR
  const simFloor = target ? ceilMinPriceTo10(target.minMarginPrice) : 0
  const simPrice = target ? roundPriceTo10(target.salePrice) : 0

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onOpenChange(false)}>
        <DialogContent className="max-h-[90vh] w-[95vw] max-w-6xl overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>쿠팡 판매가 반영</DialogTitle>
            <DialogDescription>
              {target?.channelName} 채널에 {target && target.rows.length > 1 ? '세트' : '옵션'}{' '}
              가격을 반영합니다. 확인하면 바로 쿠팡에 반영됩니다(보통 1분 안).
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

          <div className="grid gap-3 rounded-md border bg-muted/30 px-3 py-3 text-sm sm:grid-cols-2">
            <label className="space-y-1">
              <span className="font-medium">쿠팡 판매가</span>
              <Input
                type="number"
                inputMode="numeric"
                step={10}
                value={price || ''}
                onChange={(e) => setPrice(Number(e.target.value))}
                className="h-9 tabular-nums"
              />
              <span className="block text-xs text-muted-foreground">
                시뮬 판매가 ₩{fmt(simPrice)}
                {priceR !== simPrice && ' — 이 반영에만 바뀐 값을 씁니다'}
              </span>
            </label>
            <label className="space-y-1">
              <span className="font-medium">자동조정 최저가 (자동 가격조정 켜짐)</span>
              <Input
                type="number"
                inputMode="numeric"
                step={10}
                value={floor || ''}
                onChange={(e) => setFloor(Number(e.target.value))}
                className="h-9 tabular-nums"
              />
              <span className="block text-xs text-muted-foreground">
                기본값 = 최소마진 {target ? (target.minMarginPct * 100).toFixed(0) : 0}% 가격 ₩
                {fmt(simFloor)}
              </span>
            </label>
            <p className="flex items-start gap-1 text-xs text-amber-700 sm:col-span-2">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              꺼져 있던 옵션도 자동조정이 켜지고, Wing 에서 정한 최저가는 이 값으로 바뀝니다.
            </p>
          </div>

          {floorTooHigh && (
            <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <p className="text-destructive">
                쿠팡은 <b>자동조정 최저가가 판매가보다 낮아야</b> 반영됩니다. 지금 최저가 ₩
                {fmt(floorR)}가 판매가 ₩{fmt(priceR)}보다 높거나 같습니다. 판매가를 더 낮추면 오히려
                계속 막힙니다.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setPrice(floorR + 10)}
                >
                  판매가를 ₩{fmt(floorR + 10)}로 올리기
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={priceR <= 10}
                  onClick={() => setFloor(priceR - 10)}
                >
                  최저가를 ₩{fmt(Math.max(0, priceR - 10))}로 내리기
                </Button>
              </div>
            </div>
          )}

          {!floorTooHigh && floorR > 0 && floorR < simFloor && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              최저가 ₩{fmt(floorR)}가 최소마진 {target ? (target.minMarginPct * 100).toFixed(0) : 0}
              % 가격 ₩{fmt(simFloor)}보다 낮습니다 — 쿠팡 자동조정이 마진 하한 아래까지 가격을 내릴
              수 있습니다.
            </div>
          )}

          {unlinkedCount > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {targets.length}개 중 {unlinkedCount}개는 쿠팡 옵션과 연결되지 않아 반영되지 않습니다
              — 쿠팡 상품 매칭에서 확정하거나 행의 [쿠팡 옵션 연결]을 누르세요.
            </div>
          )}

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

          <Link
            href={SELLER_HUB_COUPANG_MATCHING_PATH}
            className="text-xs text-muted-foreground underline"
          >
            쿠팡 상품 매칭 관리
          </Link>

          <div className="rounded-md border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead>리스팅명</TableHead>
                  <TableHead className="w-[100px] text-right">현재가</TableHead>
                  <TableHead className="w-[100px] text-right">목표가</TableHead>
                  <TableHead className="w-[110px] text-right whitespace-normal">
                    자동조정 최저가
                  </TableHead>
                  <TableHead className="w-[70px] text-right">Δ%</TableHead>
                  <TableHead className="w-[100px]">스냅샷</TableHead>
                  <TableHead className="w-[150px]" />
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
                      <TableCell className="font-medium break-words whitespace-normal">
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
                      <TableCell className="text-right tabular-nums">
                        ₩{fmt(t.apMinSalePrice)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.deltaPct != null ? `${(t.deltaPct * 100).toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {ageLabel(t.snapshotAgeHours)}
                      </TableCell>
                      <TableCell>
                        {t.vendorItemId == null ? (
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
                        ) : t.blockedReason && !floorTooHigh ? (
                          // 최저가 규칙 위반은 위 안내 박스에서 한 번만 설명한다.
                          <Badge
                            variant="outline"
                            className="border-destructive/40 whitespace-normal text-destructive"
                          >
                            {t.blockedReason}
                          </Badge>
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
                      <li
                        key={r.listingId}
                        className={r.ok ? 'text-emerald-700' : 'text-destructive'}
                      >
                        {t?.listingName ?? r.listingId} —{' '}
                        {r.ok
                          ? `₩${fmt(t?.targetPrice ?? 0)} 반영`
                          : `실패: ${r.error ?? '알 수 없음'}`}
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
            <Button
              onClick={handleSubmit}
              disabled={submitting || loading || inFlight || writableCount === 0}
            >
              {submitting
                ? '요청 중...'
                : inFlight
                  ? '반영 중...'
                  : `쿠팡에 반영 (${writableCount}개)`}
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
            if (target) void loadPreview(target, price, floor)
          }}
        />
      )}
    </>
  )
}
