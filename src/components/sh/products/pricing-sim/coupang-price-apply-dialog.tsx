'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { APPROVALS_PATH } from '@/lib/deck-routes'
import { wingListingUrl } from '@/lib/coupang/wing-link'

import { CoupangItemPickerDialog } from './coupang-item-picker-dialog'

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
  productId: string
  optionIds: string[]
  quantity: number
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
}

export function CoupangPriceApplyDialog({ target, onOpenChange }: Props) {
  const open = target != null

  const [loading, setLoading] = useState(false)
  const [targets, setTargets] = useState<PreviewTarget[]>([])
  const [ambiguous, setAmbiguous] = useState<PreviewResponse['ambiguous']>([])
  const [apActive, setApActive] = useState(true)
  const [pickerListing, setPickerListing] = useState<{ id: string; name: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [missingOptionNames, setMissingOptionNames] = useState<string[]>([])

  const loadPreview = useMemo(
    () => async (t: CoupangApplyTarget) => {
      setLoading(true)
      try {
        const res = await fetch('/api/sh/coupang-price/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: t.channelId,
            optionIds: t.optionIds,
            quantity: t.quantity,
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
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '미리보기 조회 실패')
        setTargets([])
        setAmbiguous([])
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (target) {
      setApActive(true)
      void loadPreview(target)
    } else {
      setTargets([])
      setAmbiguous([])
      setMissingOptionNames([])
    }
  }, [target, loadPreview])

  // 가격그룹 옵션 중 매칭된 판매채널 상품이 하나도 없는 옵션(matched 도 ambiguous 도 아님)을
  // UI 경계에서 별도 조회해 이름을 붙인다. deriveListings는 각 옵션당 시그니처 1개 → 리스팅
  // 0/1/2+개의 bijection이므로, targets+ambiguous에 등장한 리스팅의 구성으로 "커버된 옵션"을
  // 역산할 수 있다. (deriveListings 자체는 다른 태스크에서 리뷰 중이라 손대지 않는다)
  useEffect(() => {
    if (!target || loading) return
    const accounted = targets.length + ambiguous.length
    if (accounted >= target.optionIds.length) {
      setMissingOptionNames([])
      return
    }
    let cancelled = false
    const resolveMissing = async () => {
      try {
        const coveredListingIds = new Set([
          ...targets.map((t) => t.listingId),
          ...ambiguous.flat().map((l) => l.id),
        ])
        const [listingsRes, productRes] = await Promise.all([
          fetch(`/api/sh/products/listings?channelId=${target.listingChannelId}&pageSize=100`),
          fetch(`/api/sh/products/${target.productId}`),
        ])
        const listingsData: { data: Array<{ id: string; items: Array<{ optionId: string }> }> } =
          await listingsRes.json()
        const productData: { product: { options: Array<{ id: string; name: string }> } } =
          await productRes.json()
        if (cancelled) return
        const coveredOptionIds = new Set<string>()
        for (const l of listingsData.data ?? []) {
          if (coveredListingIds.has(l.id) && l.items.length === 1) {
            coveredOptionIds.add(l.items[0].optionId)
          }
        }
        const nameById = new Map((productData.product?.options ?? []).map((o) => [o.id, o.name]))
        const missing = target.optionIds
          .filter((id) => !coveredOptionIds.has(id))
          .map((id) => nameById.get(id) ?? id)
        setMissingOptionNames(missing)
      } catch {
        if (!cancelled) setMissingOptionNames([])
      }
    }
    void resolveMissing()
    return () => {
      cancelled = true
    }
  }, [target, targets, ambiguous, loading])

  async function handleSubmit() {
    if (!target) return
    const writable = targets.filter((t) => t.blockedReason == null)
    if (writable.length === 0) {
      toast.error('반영 가능한 대상이 없습니다')
      return
    }
    setSubmitting(true)
    try {
      const channelAxis =
        target.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH ? 'RG' : 'MP'
      const res = await fetch('/api/agent/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType: 'seller-hub.coupang-price.change',
          summary: `${target.channelName} 쿠팡 판매가 반영 — ${writable.length}개 옵션`,
          params: {
            channelAxis,
            channelId: target.channelId,
            apActive,
            targets: writable.map((t) => ({
              listingId: t.listingId,
              vendorItemId: t.vendorItemId,
              listingName: t.listingName,
              currentPrice: t.currentPrice,
              targetPrice: t.targetPrice,
              apMinSalePrice: t.apMinSalePrice,
            })),
            rationale: {
              costPrice: target.costPrice,
              channelFeePct: target.channelFeePct,
              shippingCost: target.shippingCost,
              targetMargin: target.targetMargin,
              computedMargin: target.computedMargin,
              discountRate: target.discountRate,
              promotionLabel: target.promotionLabel,
              includeVat: target.includeVat,
              vatRate: target.vatRate,
            },
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? '승인 요청 생성 실패')
      toast.success('승인 대기에 등록했습니다', {
        action: { label: '승인 큐 보기', onClick: () => window.open(APPROVALS_PATH, '_blank') },
      })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '승인 요청 생성 실패')
    } finally {
      setSubmitting(false)
    }
  }

  const writableCount = targets.filter((t) => t.blockedReason == null).length

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onOpenChange(false)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>쿠팡 판매가 반영</DialogTitle>
            <DialogDescription>
              {target?.channelName} 채널의 옵션 {target?.optionIds.length ?? 0}개를 쿠팡 판매가에
              반영합니다. 승인 큐에 등록되며, 실제 반영은 승인 후 워커가 실행합니다.
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

          <div className="rounded-md border bg-muted/30 px-3 py-2.5">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={apActive} onCheckedChange={(v) => setApActive(!!v)} />
              <span>
                <span className="font-medium">자동 가격조정 유지</span>
                <span className="ml-2 text-muted-foreground tabular-nums">
                  최저가 ₩{target ? fmt(target.minMarginPrice) : 0} (최소마진{' '}
                  {target ? (target.minMarginPct * 100).toFixed(0) : 0}% 기준)
                </span>
                <p className="mt-1 flex items-start gap-1 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  쿠팡은 이 옵션의 현재 자동조정 상태를 알려주지 않습니다. 체크를 해제하면
                  자동조정이 꺼집니다.
                </p>
              </span>
            </label>
          </div>

          {missingOptionNames.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              판매채널 상품이 없어 반영할 수 없는 옵션 {missingOptionNames.length}개:{' '}
              {missingOptionNames.join(', ')}
            </div>
          )}

          {ambiguous.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              같은 옵션에 판매채널 상품이 여러 개 매칭되어 자동으로 고를 수 없습니다:{' '}
              {ambiguous.map((g) => g.map((l) => l.name).join(' / ')).join(', ')}
            </div>
          )}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>리스팅명</TableHead>
                  <TableHead className="text-right">현재가</TableHead>
                  <TableHead className="text-right">목표가</TableHead>
                  <TableHead className="text-right">Δ%</TableHead>
                  <TableHead>스냅샷</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      불러오는 중...
                    </TableCell>
                  </TableRow>
                ) : targets.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
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

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              취소
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || loading || writableCount === 0}>
              {submitting ? '등록 중...' : `승인 요청 (${writableCount}개)`}
            </Button>
          </DialogFooter>
          <Link href={APPROVALS_PATH} className="text-xs text-muted-foreground underline">
            승인 큐 바로가기
          </Link>
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
