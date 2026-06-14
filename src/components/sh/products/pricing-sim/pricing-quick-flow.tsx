'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

import type {
  MatrixBundle,
  MatrixChannel,
  MatrixGlobals,
  MatrixPromotion,
} from '@/lib/sh/pricing-matrix-calc'
import type { TierThresholds } from '@/lib/sh/margin-tier'
import { SELLER_HUB_LISTING_NEW_PATH } from '@/lib/deck-routes'

import { BundleRow, type ResolvedComponent } from './pricing-bundle-row'
import { ChannelResultCard } from './pricing-channel-result-card'
import { PricingPromotionCard, type PromotionValue } from './pricing-promotion-card'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

// /api/channels 응답 형태
type ApiCh = {
  id: string
  name: string
  channelTypeDef: { id: string; name: string; isSalesChannel: boolean } | null
  useSimulation: boolean
  feeRates: { categoryName: string; ratePercent: string | number }[]
  shippingFee: string | number | null
  freeShippingThreshold: string | number | null
  applyAdCost: boolean
  paymentFeeIncluded: boolean
  paymentFeePct: string | number | null
}

// settings API 응답 형태 (/api/sh/settings serializeSettings 키와 일치)
type SettingsRaw = {
  defaultOperatingCostPct?: number
  defaultAdCostPct?: number
  defaultPackagingCost?: number
  platformTargetGood?: number
  platformTargetFair?: number
  minimumAcceptableMargin?: number
  defaultReturnRate?: number // 0~1
  defaultReturnShipping?: number // 원/건
  defaultIncludeVat?: boolean
  defaultVatRate?: number // 0~1
}

type FullSettings = {
  defaultOperatingCostPct: number
  defaultAdCostPct: number
  defaultPackagingCost: number
  platformTargetGood: number
  platformTargetFair: number
  minimumAcceptableMargin: number
  defaultReturnRate: number // 0~1
  defaultReturnShipping: number // 원/건
  defaultIncludeVat: boolean
  defaultVatRate: number // 0~1
}

/** 안정 ID를 가진 번들 행 엔트리 */
type RowEntry = {
  id: string
  resolved: ResolvedComponent | null
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

/** ApiCh → MatrixChannel 변환 */
function apiChToMatrixChannel(c: ApiCh): MatrixChannel {
  const channelType = c.channelTypeDef?.isSalesChannel === false ? 'INTERNAL_TRANSFER' : null
  return {
    id: c.id,
    name: c.name,
    channelType,
    feeRates:
      c.feeRates.length > 0
        ? c.feeRates.map((fr) => ({
            categoryName: fr.categoryName,
            ratePercent: Number(fr.ratePercent),
          }))
        : [{ categoryName: '기본', ratePercent: 0 }],
    paymentFeeIncluded: c.paymentFeeIncluded,
    paymentFeePct: c.paymentFeePct != null ? Number(c.paymentFeePct) : 0,
    applyAdCost: c.applyAdCost,
    shippingFee: c.shippingFee != null ? Number(c.shippingFee) : 0,
    freeShippingThreshold: c.freeShippingThreshold != null ? Number(c.freeShippingThreshold) : null,
  }
}

/** settings → MatrixGlobals */
function buildGlobals(s: FullSettings): MatrixGlobals {
  return {
    includeVat: s.defaultIncludeVat,
    vatRate: s.defaultVatRate,
    adCostPct: s.defaultAdCostPct / 100,
    operatingCostPct: s.defaultOperatingCostPct / 100,
    // 반품률이 설정돼 있으면 반품 보정 적용 (0이면 비활성)
    applyReturnAdjustment: s.defaultReturnRate > 0,
    expectedReturnRate: s.defaultReturnRate,
    returnHandlingCost: s.defaultReturnShipping,
    minimumAcceptableMargin: s.minimumAcceptableMargin,
  }
}

/** settings → TierThresholds */
function buildThresholds(s: FullSettings): TierThresholds {
  return {
    platformTargetGood: s.platformTargetGood,
    platformTargetFair: s.platformTargetFair,
  }
}

/** 숫자 포맷 */
function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

/** 고유 행 ID 생성 */
let _rowSeq = 0
function nextRowId(): string {
  return `row-${++_rowSeq}`
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────────

export function PricingQuickFlow() {
  const router = useRouter()

  // ── 글로벌 설정 (초기 로드) ────────────────────────────────────────────────
  const [settings, setSettings] = useState<FullSettings>({
    defaultOperatingCostPct: 0,
    defaultAdCostPct: 0,
    defaultPackagingCost: 0,
    platformTargetGood: 0.25,
    platformTargetFair: 0.15,
    minimumAcceptableMargin: 0.1,
    defaultReturnRate: 0,
    defaultReturnShipping: 0,
    defaultIncludeVat: true,
    defaultVatRate: 0.1,
  })

  // ── 채널 목록 ─────────────────────────────────────────────────────────────
  const [allChannels, setAllChannels] = useState<ApiCh[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [stRes, chRes] = await Promise.all([
          fetch('/api/sh/settings'),
          fetch('/api/channels?isActive=true&isSalesChannel=true'),
        ])
        if (stRes.ok) {
          const d: { settings: SettingsRaw } = await stRes.json()
          const s = d.settings ?? {}
          if (!cancelled) {
            setSettings({
              defaultOperatingCostPct: Number(s.defaultOperatingCostPct ?? 0) || 0,
              defaultAdCostPct: Number(s.defaultAdCostPct ?? 0) || 0,
              defaultPackagingCost: Number(s.defaultPackagingCost ?? 0) || 0,
              platformTargetGood: Number(s.platformTargetGood ?? 0.25),
              platformTargetFair: Number(s.platformTargetFair ?? 0.15),
              minimumAcceptableMargin: Number(s.minimumAcceptableMargin ?? 0.1),
              defaultReturnRate: Number(s.defaultReturnRate ?? 0) || 0,
              defaultReturnShipping: Number(s.defaultReturnShipping ?? 0) || 0,
              defaultIncludeVat: s.defaultIncludeVat ?? true,
              defaultVatRate: Number(s.defaultVatRate ?? 0.1),
            })
          }
        }
        if (chRes.ok) {
          const d: { channels?: ApiCh[] } = await chRes.json()
          if (!cancelled) setAllChannels(d.channels ?? [])
        }
      } catch {
        // 기본값 유지
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // ── 번들 행 상태 ──────────────────────────────────────────────────────────
  // 안정 ID 배열로 관리 → 인라인 화살표 함수 없이 rowId로 변경 위임
  const [rows, setRows] = useState<RowEntry[]>(() => [{ id: nextRowId(), resolved: null }])

  // BundleRow.onChange 시그니처: (rowId, component) — useCallback([]) 안정 참조
  // 이 함수는 절대 새 참조를 만들지 않으므로 BundleRow effect의 dep으로 안전
  const handleRowChange = useCallback((rowId: string, component: ResolvedComponent | null) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === rowId)
      if (idx === -1) return prev
      // 값이 실제로 바뀐 경우에만 새 배열 생성 (참조 안정화)
      if (prev[idx].resolved === component) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], resolved: component }
      return next
    })
  }, [])

  const addRow = () => {
    setRows((prev) => [...prev, { id: nextRowId(), resolved: null }])
  }

  // setRows 업데이터만 사용 — 안정 참조이므로 useCallback([])로 충분 (ref 불필요)
  const handleRemoveRow = useCallback((rowId: string) => {
    setRows((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((r) => r.id !== rowId)
    })
  }, [])

  // 확정된 행만
  const confirmedRows = useMemo(
    () => rows.map((r) => r.resolved).filter((r): r is ResolvedComponent => r !== null),
    [rows]
  )

  // 번들 이름 (첫 번째 상품명 + "외 N")
  const defaultBundleName = useMemo(() => {
    if (confirmedRows.length === 0) return ''
    const first = confirmedRows[0].productName
    return confirmedRows.length > 1 ? `${first} 외 ${confirmedRows.length - 1}` : first
  }, [confirmedRows])

  const [bundleNameInput, setBundleNameInput] = useState('')
  const bundleName = bundleNameInput || defaultBundleName

  // 번들 비용 요약
  const bundleCostSummary = useMemo(() => {
    if (confirmedRows.length === 0) return null
    const totalCost = confirmedRows.reduce((s, r) => s + r.costPrice * r.quantity, 0)
    const totalRetail = confirmedRows.reduce((s, r) => s + r.retailPrice * r.quantity, 0)
    return { totalCost, totalRetail }
  }, [confirmedRows])

  // MatrixBundle 구성
  const matrixBundle = useMemo<MatrixBundle | null>(() => {
    if (confirmedRows.length === 0) return null
    return {
      components: confirmedRows.map((r) => ({
        costPrice: r.costPrice,
        retailPrice: r.retailPrice,
        quantity: r.quantity,
      })),
      packagingCost: settings.defaultPackagingCost,
      salePrice: 0, // 판매가는 별도 슬라이더로 오버라이드
    }
  }, [confirmedRows, settings.defaultPackagingCost])

  // ── 채널 선택 ─────────────────────────────────────────────────────────────
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])
  const [channelPickerId, setChannelPickerId] = useState<string>('')

  const addChannel = (id: string) => {
    if (!id || selectedChannelIds.includes(id)) return
    setSelectedChannelIds((prev) => [...prev, id])
    setChannelPickerId('')
  }

  const removeChannel = (id: string) => {
    setSelectedChannelIds((prev) => prev.filter((c) => c !== id))
  }

  const selectedMatrixChannels = useMemo(
    () =>
      selectedChannelIds
        .map((id) => allChannels.find((c) => c.id === id))
        .filter((c): c is ApiCh => c != null)
        .map(apiChToMatrixChannel),
    [selectedChannelIds, allChannels]
  )

  // 추가 가능한 채널 목록 (이미 선택된 것 제외)
  const availableChannels = useMemo(
    () => allChannels.filter((c) => !selectedChannelIds.includes(c.id)),
    [allChannels, selectedChannelIds]
  )

  // ── 판매가 슬라이더 + 입력 ────────────────────────────────────────────────
  const [salePriceInput, setSalePriceInput] = useState<string>('')
  const salePrice = useMemo(() => {
    const n = Number(salePriceInput)
    return Number.isFinite(n) && n > 0 ? n : 0
  }, [salePriceInput])

  // 슬라이더 최대값: 소비자가 합계 × 2 (최소 10000)
  const sliderMax = useMemo(() => {
    const baseline = bundleCostSummary?.totalRetail ?? 0
    const upperEstimate = baseline > 0 ? baseline * 2 : 100000
    return Math.max(upperEstimate, baseline, 10000)
  }, [bundleCostSummary])

  const handleSliderChange = (vals: number[]) => {
    setSalePriceInput(String(Math.round(vals[0])))
  }

  const handleSetSalePrice = (price: number) => {
    setSalePriceInput(String(Math.round(price)))
  }

  // 번들에 판매가 주입
  const effectiveBundle = useMemo<MatrixBundle | null>(() => {
    if (!matrixBundle || salePrice <= 0) return null
    return { ...matrixBundle, salePrice }
  }, [matrixBundle, salePrice])

  // ── 프로모션 ──────────────────────────────────────────────────────────────
  const [promotion, setPromotion] = useState<PromotionValue>({ type: 'NONE', value: 0 })

  // PromotionValue(UI) → MatrixPromotion(엔진): PERCENT는 0~100 → 0~1 변환
  const matrixPromotion = useMemo<MatrixPromotion>(
    () => ({
      type: promotion.type,
      value: promotion.type === 'PERCENT' ? promotion.value / 100 : promotion.value,
      minThreshold: promotion.minThreshold,
    }),
    [promotion]
  )

  // ── 설정값 ────────────────────────────────────────────────────────────────
  const matrixGlobals = useMemo(() => buildGlobals(settings), [settings])
  const tierThresholds = useMemo(() => buildThresholds(settings), [settings])

  // ── 핸드오프 판단 ─────────────────────────────────────────────────────────
  // 단일 상품 번들 여부: 모든 행이 같은 productId
  const isSingleProduct = useMemo(() => {
    if (confirmedRows.length === 0) return false
    const first = confirmedRows[0].productId
    return confirmedRows.every((r) => r.productId === first)
  }, [confirmedRows])

  const canCreate =
    isSingleProduct && confirmedRows.length > 0 && salePrice > 0 && selectedChannelIds.length > 0

  const handleCreateListing = () => {
    if (!canCreate) {
      toast.error('상품, 채널, 판매가를 모두 입력해 주세요')
      return
    }

    const firstChannelId = selectedChannelIds[0]
    const firstRow = confirmedRows[0]

    const key = `pricing-prefill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const payload = {
      schemaVersion: 2,
      spaceId: '',
      channelId: firstChannelId,
      productId: firstRow.productId,
      items: confirmedRows.map((r) => ({
        optionId: r.optionId,
        productId: r.productId,
        quantity: r.quantity,
      })),
      salePrice,
      createdAt: Date.now(),
    }

    try {
      sessionStorage.setItem(key, JSON.stringify(payload))
    } catch {
      toast.error('세션 스토리지 저장 실패')
      return
    }

    router.push(`${SELLER_HUB_LISTING_NEW_PATH}?prefillKey=${key}`)
  }

  // ─── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">상품·번들 가격 시뮬레이션</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── 섹션 1: 번들 구성 ── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">번들 구성</h3>
            {bundleName && (
              <span className="max-w-[200px] truncate text-xs text-muted-foreground">
                {bundleName}
              </span>
            )}
          </div>

          {/* 번들 행 목록 — key=row.id (안정 ID) 로 keying */}
          <div className="space-y-2">
            {rows.map((row, idx) => (
              <BundleRow
                key={row.id}
                rowId={row.id}
                rowIndex={idx}
                onChange={handleRowChange}
                onRemove={handleRemoveRow}
                showRemove={rows.length > 1}
              />
            ))}
          </div>

          {/* 상품 추가 버튼 */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={addRow}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            상품 추가
          </Button>

          {/* 번들 이름 입력 (2개 이상) */}
          {confirmedRows.length >= 2 && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">번들 이름 (선택)</Label>
              <Input
                value={bundleNameInput}
                onChange={(e) => setBundleNameInput(e.target.value)}
                placeholder={defaultBundleName}
                className="h-8 text-sm"
              />
            </div>
          )}

          {/* 번들 비용 요약 */}
          {bundleCostSummary && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-muted/30 px-3 py-2 text-xs">
              <span>
                총 원가{' '}
                <span className="font-semibold tabular-nums">
                  {fmt(bundleCostSummary.totalCost)}원
                </span>
              </span>
              <span>
                소비자가 합계{' '}
                <span className="font-semibold tabular-nums">
                  {fmt(bundleCostSummary.totalRetail)}원
                </span>
              </span>
            </div>
          )}
        </section>

        {/* ── 섹션 2: 채널 선택 ── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">판매채널</h3>

          {/* 선택된 채널 목록 */}
          {selectedMatrixChannels.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedMatrixChannels.map((ch) => (
                <Badge key={ch.id} variant="secondary" className="gap-1.5 pr-1">
                  {ch.name}
                  <button
                    type="button"
                    onClick={() => removeChannel(ch.id!)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`${ch.name} 제거`}
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {/* 채널 추가 picker */}
          {availableChannels.length > 0 && (
            <Select value={channelPickerId} onValueChange={addChannel}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="채널 추가..." />
              </SelectTrigger>
              <SelectContent>
                {availableChannels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {allChannels.length > 0 &&
            availableChannels.length === 0 &&
            selectedChannelIds.length > 0 && (
              <p className="text-xs text-muted-foreground">모든 채널이 추가되었습니다</p>
            )}
        </section>

        {/* ── 섹션 3: 판매가 레버 ── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">판매가</h3>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type="number"
                value={salePriceInput}
                onChange={(e) => setSalePriceInput(e.target.value)}
                placeholder="판매가 입력"
                className="h-8 [appearance:textfield] pr-6 text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                min={0}
              />
              <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">
                원
              </span>
            </div>
            {salePrice > 0 && (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {fmt(salePrice)}원
              </span>
            )}
          </div>

          {/* 슬라이더 */}
          <Slider
            min={0}
            max={sliderMax}
            step={100}
            value={[salePrice]}
            onValueChange={handleSliderChange}
            className="py-1"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0원</span>
            <span>{fmt(sliderMax)}원</span>
          </div>
        </section>

        {/* ── 섹션 4: 프로모션 ── */}
        <section>
          <PricingPromotionCard value={promotion} onChange={setPromotion} embedded />
        </section>

        {/* ── 섹션 5: 라이브 결과 (채널별) ── */}
        {effectiveBundle && selectedMatrixChannels.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">채널별 마진 결과</h3>
            <div className="space-y-3">
              {selectedMatrixChannels.map((ch) => (
                <ChannelResultCard
                  key={ch.id}
                  channel={ch}
                  bundle={effectiveBundle}
                  promotion={matrixPromotion}
                  globals={matrixGlobals}
                  thresholds={tierThresholds}
                  onSetSalePrice={handleSetSalePrice}
                  onRemove={() => removeChannel(ch.id!)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── 핸드오프 버튼 ── */}
        {confirmedRows.length > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-full">
                  <Button
                    onClick={handleCreateListing}
                    disabled={!canCreate}
                    size="sm"
                    className="w-full"
                  >
                    판매채널 상품으로 생성
                  </Button>
                </div>
              </TooltipTrigger>
              {!isSingleProduct && (
                <TooltipContent side="top" className="max-w-[280px] text-xs">
                  다중 상품 번들은 현재 판매채널 상품 자동 생성을 지원하지 않습니다 (단일 상품만).
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        )}

        {/* 다중 상품 번들 — 핸드오프 비활성 사유를 인라인으로 명시 (비활성 버튼은 hover 어려움) */}
        {confirmedRows.length > 1 && !isSingleProduct && (
          <p className="text-center text-[11px] text-muted-foreground">
            다중 상품 번들은 판매채널 상품 자동 생성을 지원하지 않습니다 (단일 상품만 가능).
          </p>
        )}
      </CardContent>
    </Card>
  )
}
