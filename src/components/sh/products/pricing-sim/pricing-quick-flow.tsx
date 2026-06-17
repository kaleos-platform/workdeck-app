'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Info, Plus, RotateCcw, Save, Settings2 } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { calculateMatrix } from '@/lib/sh/pricing-matrix-calc'
import type {
  MatrixBundle,
  MatrixChannel,
  MatrixGlobals,
  MatrixPromotion,
} from '@/lib/sh/pricing-matrix-calc'
import type { TierThresholds } from '@/lib/sh/margin-tier'
import { snapPrice } from '@/lib/sh/price-snap'

import { BundleRow, type ResolvedComponent } from './pricing-bundle-row'
import { PricingChannelBoardCard } from './pricing-channel-board-card'
import { PricingPromotionCard, type PromotionValue } from './pricing-promotion-card'
import { PricingDefaultsDialog, type PricingFullSettings } from './pricing-defaults-dialog'

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
// 전체 15필드 — 다이얼로그(PricingFullSettings)와 동일 형상으로 보관해
// 다이얼로그 저장 시 비계산 필드(channelFee/shipping/auto*)를 0으로 덮어쓰지 않게 한다.
type SettingsRaw = Partial<PricingFullSettings>

/** 안정 ID를 가진 번들 행 엔트리 */
type RowEntry = {
  id: string
  resolved: ResolvedComponent | null
}

/**
 * 좌측 패널에서 라이브 조정하는 시뮬 설정 (세션 한정, 미저장).
 * 설정 다이얼로그 기본값에서 초기화 → 슬라이더/토글로 즉시 덮어쓰기.
 * 모든 채널 매트릭스에 공통 적용 (채널 DB 값보다 우선).
 */
type LiveSim = {
  targetMargin: number // 0~1 목표 마진율 (good 역산 기준)
  minMargin: number // 0~1 마진 하한 (프로모션 방어선)
  includeVat: boolean
  vatRate: number // 0~1
  returnRate: number // 0~1
  returnHandling: number // 원/건
  shippingCost: number // 원 (물류·풀필먼트, 전 채널 공통)
  paymentFeePct: number // 0~1 PG (전 채널 공통)
  applyAdCost: boolean // 광고비 사용
  adCostPct: number // 0~1 광고비 기본값 (채널별 미입력 시 fallback)
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

/** ApiCh → MatrixChannel — 채널 수수료는 DB, 나머지 비용은 라이브 설정으로 override */
function apiChToMatrixChannel(c: ApiCh, live: LiveSim): MatrixChannel {
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
    // PG·배송비는 라이브 설정(전 채널 공통)으로 override
    paymentFeeIncluded: false,
    paymentFeePct: live.paymentFeePct,
    applyAdCost: live.applyAdCost,
    shippingFee: live.shippingCost,
    // 물류비는 항상 비용 반영 (threshold > 0, 모든 가격 초과)
    freeShippingThreshold: live.shippingCost > 0 ? 1 : null,
  }
}

/** LiveSim → MatrixGlobals (해당 채널 광고비율 주입) */
function buildGlobals(live: LiveSim, adPct: number): MatrixGlobals {
  return {
    includeVat: live.includeVat,
    vatRate: live.vatRate,
    adCostPct: adPct,
    operatingCostPct: 0, // 신 모델 미사용
    applyReturnAdjustment: live.returnRate > 0,
    expectedReturnRate: live.returnRate,
    returnHandlingCost: live.returnHandling,
    minimumAcceptableMargin: live.minMargin,
  }
}

/** settings → LiveSim 초기값 */
function liveFromSettings(s: PricingFullSettings): LiveSim {
  return {
    targetMargin: s.platformTargetGood,
    minMargin: s.minimumAcceptableMargin,
    includeVat: s.defaultIncludeVat,
    vatRate: s.defaultVatRate,
    returnRate: s.defaultReturnRate,
    returnHandling: s.defaultReturnShipping,
    shippingCost: s.defaultShippingCost,
    // PG는 설정에 별도 필드 없음 — 운영비 자리 대신 2% 기본값
    paymentFeePct: 0.02,
    applyAdCost: true,
    adCostPct: s.defaultAdCostPct / 100,
  }
}

// settings 기본값 — API 로드 전 초기 상태 (15필드 전체)
const DEFAULT_SETTINGS: PricingFullSettings = {
  defaultOperatingCostPct: 0,
  defaultAdCostPct: 8,
  defaultPackagingCost: 0,
  defaultChannelFeePct: 0,
  defaultShippingCost: 3000,
  autoApplyChannelFee: false,
  autoApplyAdCost: false,
  autoApplyShipping: false,
  defaultReturnRate: 0.15,
  defaultReturnShipping: 6000,
  defaultIncludeVat: true,
  defaultVatRate: 0.1,
  platformTargetGood: 0.3,
  platformTargetFair: 0.2,
  minimumAcceptableMargin: 0.12,
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

/** %/₩ suffix 입력 (설정 다이얼로그 패턴 재사용) */
function SuffixInput({
  value,
  onChange,
  suffix,
  step = 1,
  className,
}: {
  value: string
  onChange: (v: string) => void
  suffix: string
  step?: number
  className?: string
}) {
  return (
    <div className="relative flex items-center">
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        min={0}
        className={cn(
          'h-8 [appearance:textfield] pr-7 text-right text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          className
        )}
      />
      <span className="pointer-events-none absolute right-2.5 text-xs text-muted-foreground">
        {suffix}
      </span>
    </div>
  )
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────────

export function PricingQuickFlow() {
  // ── 글로벌 설정 (초기 로드) ────────────────────────────────────────────────
  const [settings, setSettings] = useState<PricingFullSettings>(DEFAULT_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // ── 라이브 시뮬 설정 (세션 한정 override) ─────────────────────────────────
  const [live, setLive] = useState<LiveSim>(() => liveFromSettings(DEFAULT_SETTINGS))
  // 설정이 새로 로드/저장되면 라이브값을 설정 기본값으로 리셋
  useEffect(() => {
    setLive(liveFromSettings(settings))
  }, [settings])

  const setLiveField = useCallback(<K extends keyof LiveSim>(key: K, value: LiveSim[K]) => {
    setLive((prev) => ({ ...prev, [key]: value }))
  }, [])

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
            // 15필드 전부 round-trip — 다이얼로그가 PUT으로 전체를 보내므로
            // 비계산 필드(channelFee/shipping/auto*)도 보존해야 저장 시 0 덮어쓰기 방지.
            setSettings({
              defaultOperatingCostPct: Number(s.defaultOperatingCostPct ?? 0) || 0,
              defaultAdCostPct: Number(s.defaultAdCostPct ?? 8) || 0,
              defaultPackagingCost: Number(s.defaultPackagingCost ?? 0) || 0,
              defaultChannelFeePct: Number(s.defaultChannelFeePct ?? 0) || 0,
              defaultShippingCost: Number(s.defaultShippingCost ?? 3000) || 0,
              autoApplyChannelFee: s.autoApplyChannelFee ?? false,
              autoApplyAdCost: s.autoApplyAdCost ?? false,
              autoApplyShipping: s.autoApplyShipping ?? false,
              defaultReturnRate: Number(s.defaultReturnRate ?? 0.15),
              defaultReturnShipping: Number(s.defaultReturnShipping ?? 6000) || 0,
              defaultIncludeVat: s.defaultIncludeVat ?? true,
              defaultVatRate: Number(s.defaultVatRate ?? 0.1),
              platformTargetGood: Number(s.platformTargetGood ?? 0.3),
              platformTargetFair: Number(s.platformTargetFair ?? 0.2),
              minimumAcceptableMargin: Number(s.minimumAcceptableMargin ?? 0.12),
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
  const [rows, setRows] = useState<RowEntry[]>(() => [{ id: nextRowId(), resolved: null }])

  const handleRowChange = useCallback((rowId: string, component: ResolvedComponent | null) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === rowId)
      if (idx === -1) return prev
      if (prev[idx].resolved === component) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], resolved: component }
      return next
    })
  }, [])

  const addRow = () => {
    setRows((prev) => [...prev, { id: nextRowId(), resolved: null }])
  }

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

  // MatrixBundle 구성 (salePrice는 채널 카드에서 역산)
  const matrixBundle = useMemo<MatrixBundle | null>(() => {
    if (confirmedRows.length === 0) return null
    return {
      components: confirmedRows.map((r) => ({
        costPrice: r.costPrice,
        retailPrice: r.retailPrice,
        quantity: r.quantity,
      })),
      packagingCost: settings.defaultPackagingCost,
      salePrice: 0,
    }
  }, [confirmedRows, settings.defaultPackagingCost])

  // ── 채널 선택 ─────────────────────────────────────────────────────────────
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])
  const [channelPickerId, setChannelPickerId] = useState<string>('')

  // 채널별 광고비율 override (0~1). 미설정 채널은 live.adCostPct fallback.
  const [adPctByChannel, setAdPctByChannel] = useState<Record<string, number>>({})

  const addChannel = (id: string) => {
    if (!id || selectedChannelIds.includes(id)) return
    setSelectedChannelIds((prev) => [...prev, id])
    setChannelPickerId('')
  }

  const removeChannel = (id: string) => {
    setSelectedChannelIds((prev) => prev.filter((c) => c !== id))
  }

  const adPctOf = useCallback(
    (channelId: string) => adPctByChannel[channelId] ?? live.adCostPct,
    [adPctByChannel, live.adCostPct]
  )

  const selectedApiChannels = useMemo(
    () =>
      selectedChannelIds
        .map((id) => allChannels.find((c) => c.id === id))
        .filter((c): c is ApiCh => c != null),
    [selectedChannelIds, allChannels]
  )

  // 추가 가능한 채널 목록
  const availableChannels = useMemo(
    () => allChannels.filter((c) => !selectedChannelIds.includes(c.id)),
    [allChannels, selectedChannelIds]
  )

  // ── 프로모션 ──────────────────────────────────────────────────────────────
  const [promotion, setPromotion] = useState<PromotionValue>({ type: 'NONE', value: 0 })
  const matrixPromotion = useMemo<MatrixPromotion>(
    () => ({
      type: promotion.type,
      value: promotion.type === 'PERCENT' ? promotion.value / 100 : promotion.value,
      minThreshold: promotion.minThreshold,
    }),
    [promotion]
  )

  // ── 등급 임계값 (목표마진 라이브 반영) ────────────────────────────────────
  const tierThresholds = useMemo<TierThresholds>(
    () => ({
      platformTargetGood: live.targetMargin,
      platformTargetFair: settings.platformTargetFair,
    }),
    [live.targetMargin, settings.platformTargetFair]
  )

  // ── …900 스냅 토글 ────────────────────────────────────────────────────────
  const [snap, setSnap] = useState(true)

  // ── 채널별 직접 생성 ──────────────────────────────────────────────────────
  const isSingleProduct = useMemo(() => {
    if (confirmedRows.length === 0) return false
    const first = confirmedRows[0].productId
    return confirmedRows.every((r) => r.productId === first)
  }, [confirmedRows])

  const canCreate = isSingleProduct && confirmedRows.length > 0
  const groupOptionIds = useMemo(
    () => (confirmedRows.length > 0 ? confirmedRows[0].optionIds : []),
    [confirmedRows]
  )
  const createQuantity = confirmedRows.length > 0 ? Math.max(1, confirmedRows[0].quantity) : 1

  // 생성 확인 대상 (채널 + 권장가) + 생성 중 채널 id
  const [confirmTarget, setConfirmTarget] = useState<{
    channel: MatrixChannel
    price: number
  } | null>(null)
  const [creatingChannelId, setCreatingChannelId] = useState<string | null>(null)

  const handleCreateForChannel = async (channel: MatrixChannel, price: number) => {
    if (!canCreate || !channel.id || groupOptionIds.length === 0) {
      toast.error('상품을 먼저 설정해 주세요')
      return
    }
    setCreatingChannelId(channel.id)
    try {
      const name = bundleName || confirmedRows[0].productName
      const finalPrice = Math.round(price)
      const res = await fetch('/api/sh/products/listings/channel-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: channel.id,
          baseSearchName: name,
          baseDisplayName: name,
          keywords: [],
          listings: groupOptionIds.map((optionId) => ({
            searchName: name,
            displayName: name,
            retailPrice: finalPrice,
            status: 'ACTIVE' as const,
            items: [{ optionId, quantity: createQuantity }],
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? '생성 실패')
      }
      toast.success(`${channel.name}에 옵션 ${groupOptionIds.length}개 생성 완료`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '생성 실패')
    } finally {
      setCreatingChannelId(null)
      setConfirmTarget(null)
    }
  }

  // ── 초기화 ────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setRows([{ id: nextRowId(), resolved: null }])
    setBundleNameInput('')
    setSelectedChannelIds([])
    setAdPctByChannel({})
    setPromotion({ type: 'NONE', value: 0 })
    setLive(liveFromSettings(settings))
    setSnap(true)
    toast.success('시뮬레이션을 초기화했습니다')
  }

  // ── 우측 보드용 채널 + globals ─────────────────────────────────────────────
  const boardChannels = useMemo(
    () =>
      selectedApiChannels.map((c) => ({
        api: c,
        adPct: adPctOf(c.id),
        channel: apiChToMatrixChannel(c, live),
      })),
    [selectedApiChannels, live, adPctOf]
  )

  // KPI — 통과 채널 수 + 권장가 범위. 카드와 동일 역산(good)을 한 번 더 계산.
  const boardSummary = useMemo(() => {
    if (!matrixBundle || boardChannels.length === 0) return null
    const prices: number[] = []
    for (const bc of boardChannels) {
      const m = calculateMatrix({
        bundle: { ...matrixBundle, salePrice: 0 },
        channel: bc.channel,
        promotion: { type: 'NONE', value: 0 },
        globals: buildGlobals(live, bc.adPct),
        thresholds: tierThresholds,
      })
      const good = m.recommendedRetail.good
      if (good != null) prices.push(snap ? snapPrice(good, 'end900') : Math.round(good))
    }
    return {
      total: boardChannels.length,
      pass: prices.length,
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
    }
  }, [matrixBundle, boardChannels, live, tierThresholds, snap])

  // ─── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <div className="ps-root">
      {/* ── 헤더 ── */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">가격 시뮬레이션</h1>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={handleReset}
          >
            <RotateCcw className="h-3.5 w-3.5" /> 초기화
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => toast.info('시나리오 저장은 준비 중입니다')}
          >
            <Save className="h-3.5 w-3.5" /> 시나리오 저장
          </Button>
        </div>
      </div>

      {/* ── KPI 스트립 ── */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCell
          label="목표 마진율"
          value={`${Math.round(live.targetMargin * 100)}%`}
          sub={`마진 하한 ${Math.round(live.minMargin * 100)}%`}
          accent="emerald"
        />
        <KpiCell
          label="원가 · 매입"
          value={bundleCostSummary ? `₩${fmt(bundleCostSummary.totalCost)}` : '—'}
          sub={bundleName || '상품 미선택'}
        />
        <KpiCell
          label="통과 채널"
          value={boardSummary ? `${boardSummary.pass}` : '0'}
          sub={`/ ${boardChannels.length}개 · 권장가 기준`}
        />
        <KpiCell
          label="권장가 범위"
          value={
            boardSummary && boardSummary.min != null && boardSummary.max != null
              ? boardSummary.min === boardSummary.max
                ? `₩${fmt(boardSummary.min)}`
                : `${fmt(boardSummary.min)}~${fmt(boardSummary.max)}`
              : '—'
          }
          sub={`${live.includeVat ? 'VAT 포함' : 'VAT 미포함'} · 채널별 상이`}
        />
      </div>

      {/* ── 본문 2단 ── */}
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* ── 좌측: 스텝 패널 ── */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {/* ① 상품 선택 */}
          <StepCard
            step={1}
            title="상품 선택"
            badge={confirmedRows.length > 0 ? bundleName : '미선택'}
          >
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <BundleRow
                  key={row.id}
                  rowId={row.id}
                  rowIndex={idx}
                  resolved={row.resolved}
                  onChange={handleRowChange}
                  onRemove={handleRemoveRow}
                  showRemove={rows.length > 1}
                />
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full text-xs"
              onClick={addRow}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> 상품 추가
            </Button>
            {confirmedRows.length >= 2 && (
              <div className="mt-2 space-y-1">
                <Label className="text-[11px] text-muted-foreground">번들 이름 (선택)</Label>
                <Input
                  value={bundleNameInput}
                  onChange={(e) => setBundleNameInput(e.target.value)}
                  placeholder={defaultBundleName}
                  className="h-8 text-sm"
                />
              </div>
            )}
            {bundleCostSummary && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-[var(--ps-muted)] px-3 py-2 text-xs">
                <span>
                  총 원가{' '}
                  <span className="font-semibold tabular-nums">
                    {fmt(bundleCostSummary.totalCost)}원
                  </span>
                </span>
                <span>
                  참고 시장가{' '}
                  <span className="font-semibold tabular-nums">
                    {fmt(bundleCostSummary.totalRetail)}원
                  </span>
                </span>
              </div>
            )}
          </StepCard>

          {/* ② 시뮬레이션 설정 */}
          <StepCard
            step={2}
            title="시뮬레이션 설정"
            action={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-[11px] text-muted-foreground"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 className="h-3.5 w-3.5" /> 기본값
              </Button>
            }
          >
            <TooltipProvider delayDuration={200}>
              {/* 목표 마진율 */}
              <SliderRow
                label="목표 마진율"
                valueText={`${Math.round(live.targetMargin * 100)}%`}
                valueClass="text-emerald-700"
                hint={`마진 하한 ${Math.round(live.minMargin * 100)}%`}
                tooltip="채널별 권장 판매가(good)를 역산하는 기준. 공급가(VAT 제외) 대비 순이익율입니다."
              >
                <Slider
                  min={0}
                  max={0.6}
                  step={0.01}
                  value={[live.targetMargin]}
                  onValueChange={(v) => setLiveField('targetMargin', v[0])}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>0%</span>
                  <span>30%</span>
                  <span>60%</span>
                </div>
              </SliderRow>

              {/* 마진 하한 */}
              <SliderRow
                label="마진 하한"
                sub="프로모션 방어선"
                valueText={`${Math.round(live.minMargin * 100)}%`}
                valueClass="text-destructive"
                tooltip="프로모션 할인 방어선. 할인 여력 게이지가 이 마진 아래로 떨어지면 경고합니다."
              >
                <Slider
                  min={0}
                  max={Math.max(0.01, live.targetMargin)}
                  step={0.01}
                  value={[Math.min(live.minMargin, live.targetMargin)]}
                  onValueChange={(v) => setLiveField('minMargin', v[0])}
                />
              </SliderRow>

              {/* VAT */}
              <FieldRow
                label="부가세 (VAT)"
                sub="판매가 = VAT 포함"
                tooltip="켜면 판매가에 VAT가 포함된 것으로 보고 공급가(=판매가÷(1+VAT))로 마진을 계산합니다. 수수료·광고·PG는 판매가 기준."
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums">
                    {Math.round(live.vatRate * 100)}%
                  </span>
                  <Switch
                    checked={live.includeVat}
                    onCheckedChange={(v) => setLiveField('includeVat', v)}
                  />
                </div>
              </FieldRow>

              {/* 반품율 */}
              <FieldRow
                label="반품율"
                sub={`반품 1건 ₩${fmt(live.returnHandling)} 처리`}
                tooltip="전체 주문 대비 반품 비율. 반품 1건당 처리비만 비용에 반영합니다(매출 차감 아님)."
              >
                <SuffixInput
                  value={String(Math.round(live.returnRate * 1000) / 10)}
                  onChange={(v) => setLiveField('returnRate', (Number(v) || 0) / 100)}
                  suffix="%"
                  step={0.1}
                  className="w-20"
                />
              </FieldRow>

              {/* 반품 처리비 */}
              <FieldRow
                label="반품 처리비"
                sub="왕복 물류 + 검수 · 건당"
                tooltip="반품 1건당 왕복 물류·검수 비용. 반품율과 곱해 건당 비용으로 반영합니다."
              >
                <SuffixInput
                  value={String(live.returnHandling)}
                  onChange={(v) => setLiveField('returnHandling', Number(v) || 0)}
                  suffix="₩"
                  step={100}
                  className="w-24"
                />
              </FieldRow>

              {/* 물류·풀필먼트비 */}
              <FieldRow
                label="물류·풀필먼트비"
                sub="입출고·포장 · 건당"
                tooltip="주문 1건당 입출고·포장 고정비. 전 채널 공통 적용됩니다."
              >
                <SuffixInput
                  value={String(live.shippingCost)}
                  onChange={(v) => setLiveField('shippingCost', Number(v) || 0)}
                  suffix="₩"
                  step={100}
                  className="w-24"
                />
              </FieldRow>

              {/* PG 결제 수수료 */}
              <FieldRow
                label="PG 결제 수수료"
                sub="전 채널 공통"
                tooltip="결제대행(PG) 수수료. 판매가 기준이며 전 채널에 공통 적용됩니다."
              >
                <SuffixInput
                  value={String(Math.round(live.paymentFeePct * 1000) / 10)}
                  onChange={(v) => setLiveField('paymentFeePct', (Number(v) || 0) / 100)}
                  suffix="%"
                  step={0.1}
                  className="w-20"
                />
              </FieldRow>

              {/* 광고비 사용 */}
              <FieldRow
                label="광고비 사용"
                sub="채널별 매출 대비 비율 적용"
                tooltip="끄면 광고비 0. 켜면 ③ 판매채널의 채널별 광고비율(%)을 판매가 대비 비용으로 적용합니다."
              >
                <Switch
                  checked={live.applyAdCost}
                  onCheckedChange={(v) => setLiveField('applyAdCost', v)}
                />
              </FieldRow>
            </TooltipProvider>
          </StepCard>

          {/* ③ 판매채널 */}
          <StepCard step={3} title="판매채널" badge={`${selectedChannelIds.length}개 선택`}>
            <div className="space-y-2">
              {boardChannels.map((bc) => {
                const feeBasic =
                  bc.api.feeRates.find((f) => f.categoryName === '기본') ?? bc.api.feeRates[0]
                const feePct = feeBasic ? Number(feeBasic.ratePercent) : 0
                return (
                  <div
                    key={bc.api.id}
                    className="flex items-center gap-2 rounded-md border border-[var(--ps-border)] bg-[var(--ps-card)] px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => removeChannel(bc.api.id)}
                      className="text-emerald-600"
                      aria-label={`${bc.api.name} 선택 해제`}
                    >
                      ✓
                    </button>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium">{bc.api.name}</span>
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        수수료 {feePct.toFixed(1)}%
                      </span>
                    </div>
                    {/* 채널별 광고비율 */}
                    <SuffixInput
                      value={String(Math.round(bc.adPct * 1000) / 10)}
                      onChange={(v) =>
                        setAdPctByChannel((prev) => ({
                          ...prev,
                          [bc.api.id]: (Number(v) || 0) / 100,
                        }))
                      }
                      suffix="%"
                      step={0.1}
                      className="w-16"
                    />
                  </div>
                )
              })}
            </div>
            {availableChannels.length > 0 && (
              <Select value={channelPickerId} onValueChange={addChannel}>
                <SelectTrigger className="mt-2 h-8 text-sm">
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
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              % = 판매가(VAT 포함) 대비 채널 수수료. 광고비는 채널별 입력값을 사용합니다.
            </p>
          </StepCard>

          {/* ④ 프로모션 */}
          <StepCard step={4} title="프로모션">
            <PricingPromotionCard value={promotion} onChange={setPromotion} embedded />
            <div className="mt-3 flex items-center justify-between rounded-md bg-[var(--ps-muted)] px-3 py-2">
              <span className="text-[11px] text-muted-foreground">권장가 …900원 스냅</span>
              <Switch checked={snap} onCheckedChange={setSnap} />
            </div>
          </StepCard>
        </div>

        {/* ── 우측: 채널별 마진 보드 ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">채널별 마진 보드</h2>
            <span className="text-[11px] text-muted-foreground">실시간 갱신</span>
          </div>

          {matrixBundle && boardChannels.length > 0 ? (
            <div className="space-y-4">
              {boardChannels.map((bc) => (
                <PricingChannelBoardCard
                  key={bc.api.id}
                  channel={bc.channel}
                  bundle={matrixBundle}
                  adPct={bc.adPct}
                  promotion={matrixPromotion}
                  globals={buildGlobals(live, bc.adPct)}
                  thresholds={tierThresholds}
                  snap={snap}
                  onCreate={(ch, price) => setConfirmTarget({ channel: ch, price })}
                  creating={creatingChannelId === bc.api.id}
                  canCreate={canCreate}
                />
              ))}
              {confirmedRows.length > 1 && !isSingleProduct && (
                <p className="text-center text-[11px] text-muted-foreground">
                  다중 상품 번들은 판매채널 상품 자동 생성을 지원하지 않습니다 (단일 상품만 가능).
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-card)] px-4 py-16 text-center text-sm text-muted-foreground">
              상품과 판매채널을 선택하면 채널별 권장가와 마진 구성이 여기에 표시됩니다.
            </div>
          )}
        </div>
      </div>

      {/* 설정 팝업 */}
      <PricingDefaultsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialSettings={settings}
        onSaved={setSettings}
      />

      {/* 채널별 생성 확인 다이얼로그 */}
      <Dialog
        open={!!confirmTarget}
        onOpenChange={(v) => {
          if (!v) setConfirmTarget(null)
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>판매채널 상품 생성</DialogTitle>
            <DialogDescription>
              {confirmTarget?.channel.name}에 가격 그룹의 옵션 {groupOptionIds.length}개를 각각
              판매가 {confirmTarget ? fmt(confirmTarget.price) : 0}원으로 생성합니다. 계속할까요?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmTarget(null)}
              disabled={!!creatingChannelId}
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={() =>
                confirmTarget && handleCreateForChannel(confirmTarget.channel, confirmTarget.price)
              }
              disabled={!!creatingChannelId}
            >
              {creatingChannelId ? '생성 중...' : '생성'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── 보조 컴포넌트 ─────────────────────────────────────────────────────────────

function KpiCell({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: 'emerald'
}) {
  return (
    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-card)] px-4 py-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-xl font-bold tabular-nums',
          accent === 'emerald' && 'text-emerald-700'
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

function StepCard({
  step,
  title,
  badge,
  action,
  children,
}: {
  step: number
  title: string
  badge?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-card)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
            {step}
          </span>
          <h3 className="text-sm font-semibold">{title}</h3>
          {badge && (
            <Badge variant="secondary" className="text-[10px]">
              {badge}
            </Badge>
          )}
        </div>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

/** 라벨 옆 안내 툴팁 — Info 아이콘 hover (pricing-promotion-card 패턴) */
function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="ml-1 inline h-3 w-3 cursor-help align-text-top text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[240px] text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

function SliderRow({
  label,
  sub,
  valueText,
  valueClass,
  hint,
  tooltip,
  children,
}: {
  label: string
  sub?: string
  valueText: string
  valueClass?: string
  hint?: string
  tooltip?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium">
          {label}
          {tooltip && <HelpTip text={tooltip} />}
          {sub && (
            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">{sub}</span>
          )}
        </span>
        <span className={cn('text-sm font-bold tabular-nums', valueClass)}>{valueText}</span>
      </div>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function FieldRow({
  label,
  sub,
  tooltip,
  children,
}: {
  label: string
  sub?: string
  tooltip?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium">
          {label}
          {tooltip && <HelpTip text={tooltip} />}
        </p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
