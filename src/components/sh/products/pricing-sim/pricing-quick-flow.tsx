'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  GripVertical,
  History,
  Info,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

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
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  PRICING_DRAFT_KEY,
  isMeaningfulSnapshot,
  parseSnapshot,
  type PricingSimMode,
  type PricingSimSnapshot,
  type PricingSimSummary,
  type SnapChOverride,
} from '@/lib/sh/pricing-scenario-snapshot'

import { calculateMatrix } from '@/lib/sh/pricing-matrix-calc'
import type {
  MatrixBundle,
  MatrixChannel,
  MatrixGlobals,
  MatrixPromotion,
} from '@/lib/sh/pricing-matrix-calc'
import type { TierThresholds } from '@/lib/sh/margin-tier'
import { snapPrice } from '@/lib/sh/price-snap'

import { productDisplayName } from '@/lib/sh/product-display'
import { resolveFirstPriceGroup } from '@/lib/sh/resolve-product-price-group'
import type { OptionInput } from '@/lib/sh/price-group'
import { SELLER_HUB_PRICING_SIM_PATH, getSellerHubPricingScenarioPath } from '@/lib/deck-routes'

import { BundleRow, type ResolvedComponent } from './pricing-bundle-row'
import { ManualProductRow } from './pricing-manual-row'
import { PricingChannelBoardCard } from './pricing-channel-board-card'
import { type PromotionValue } from './pricing-promotion-card'
import { PricingDefaultsDialog, type PricingFullSettings } from './pricing-defaults-dialog'
import { mapPricingSettings } from '@/lib/sh/pricing-settings'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

// /api/channels 응답 형태
type ApiCh = {
  id: string
  name: string
  channelTypeDef: { id: string; name: string; isSalesChannel: boolean } | null
  useSimulation: boolean
  feeRates: { categoryName: string; ratePercent: string | number }[]
  shippingFeeType: 'FIXED' | 'PERCENT'
  shippingFee: string | number | null
  shippingFeePct: string | number | null
  freeShipping: boolean
  freeShippingThreshold: string | number | null
  applyAdCost: boolean
  adCostPct: string | number | null // 0~1, null=미설정 → 앱 기본값 폴백
  vatIncludedInFee: boolean // 판매 수수료율 VAT 포함 여부 (false=별도 → gross-up)
  paymentFeeIncluded: boolean
  paymentFeePct: string | number | null
  paymentFeeVatIncluded: boolean // 결제 수수료율 VAT 포함 여부 (판매와 독립)
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
 * 좌측 패널에서 라이브 조정하는 시뮬 설정 (세션 한정, 미저장) — 전 채널 공통 항목만.
 * 설정 다이얼로그 기본값에서 초기화 → 슬라이더/토글로 즉시 덮어쓰기.
 * 채널별 비용(수수료·배송·PG·광고)은 LiveSim이 아니라 채널별 override(ChOverride)로 관리한다.
 */
type LiveSim = {
  targetMargin: number // 0~1 목표 마진율 (good 역산 기준)
  minMargin: number // 0~1 마진 하한 (프로모션 방어선)
  includeVat: boolean
  vatRate: number // 0~1
  returnRate: number // 0~1
  returnHandling: number // 원/건
}

/**
 * 채널별 비용 override (세션 한정) — 채널 DB 값에서 프리필 후 화면에서 즉시 변경 가능.
 * 시뮬레이션에만 적용되며 채널 설정에는 저장되지 않는다.
 */
type ChOverride = {
  feeCategory: string // 선택된 수수료 카테고리명 (기본 '기본')
  feePct: number // 선택 카테고리 수수료율 (0~100, UI %)
  shippingFeeType: 'FIXED' | 'PERCENT' // 배송비 산정 방식
  shippingFee: number // 원 (FIXED) — 주문당 판매자 부담 배송비
  shippingFeePct: number // 0~1 (PERCENT, 판매가 대비)
  freeShipping: boolean // 항상 무료배송(고객 미부담=판매자 항상 부담)
  freeShippingThreshold: number | null // 무료배송 최소 주문금액(이상=판매자 부담, 미만=고객 부담). null=미설정
  vatIncludedInFee: boolean // 판매 수수료율 VAT 포함 여부 (false=별도 → gross-up)
  paymentFeeIncluded: boolean
  paymentFeePct: number // 0~1 PG
  paymentFeeVatIncluded: boolean // 결제 수수료율 VAT 포함 여부 (판매와 독립)
  applyAdCost: boolean
  adPct: number // 0~1 광고비율
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

// 채널·설정 모두 미설정일 때 원가 과소평가를 막기 위한 앱 내장 기본값
// (Space의 ProductPricingSettings는 DB 기본값이 0이라 실제로 비어있는 경우가 많음)
const FALLBACK_SHIPPING_COST = 3000 // 배송비 (원)
// 광고 미설정 채널에서 사용자가 광고를 켤 때 채울 기본 광고비율(rate) = 1/ROAS. ROAS 300% 기준.
const DEFAULT_AD_ROAS_RATE = 1 / 3

/**
 * 채널 DB 값에서 ChOverride 초기값 생성.
 * 채널에 명시된 값은 그대로 사용하고, 미설정 항목은 글로벌 설정값 → (그마저 0/미설정이면)
 * 앱 내장 기본값 순으로 폴백한다 (미설정=0 이 아니라 합리적 기본값 → 원가 과소평가 방지).
 * 이후 채널별로 즉시 변경 가능.
 */
function seedOverride(c: ApiCh, settings: PricingFullSettings, categoryName = '기본'): ChOverride {
  // 선택 카테고리 → (없으면) 기본 → (없으면) 첫 행. ratePercent는 0~100 UI % 직접 사용.
  const feeRow =
    c.feeRates.find((f) => f.categoryName === categoryName) ??
    c.feeRates.find((f) => f.categoryName === '기본') ??
    c.feeRates[0]
  const shippingFee =
    c.shippingFee != null
      ? Number(c.shippingFee)
      : settings.defaultShippingCost || FALLBACK_SHIPPING_COST
  return {
    feeCategory: feeRow?.categoryName ?? '기본',
    feePct: feeRow ? Number(feeRow.ratePercent) : settings.defaultChannelFeePct,
    shippingFeeType: c.shippingFeeType ?? 'FIXED',
    shippingFee,
    shippingFeePct: c.shippingFeePct != null ? Number(c.shippingFeePct) : 0,
    freeShipping: c.freeShipping ?? false,
    freeShippingThreshold: c.freeShippingThreshold != null ? Number(c.freeShippingThreshold) : null,
    // 수수료 VAT 포함 여부 — 채널값 그대로. false면 엔진이 해당 수수료를 (1+vat)배 gross-up(판매/결제 독립).
    vatIncludedInFee: c.vatIncludedInFee,
    paymentFeeVatIncluded: c.paymentFeeVatIncluded,
    // PG는 채널 설정값 그대로 반영(true=수수료에 포함=미부과). 미설정 채널 기본(포함)도 그대로.
    paymentFeeIncluded: c.paymentFeeIncluded,
    paymentFeePct: c.paymentFeePct != null ? Number(c.paymentFeePct) : 0,
    // 광고비(ROAS)는 기본 OFF(보드에서 켜서 마진 에로전 확인). 켤 때 쓸 ROAS는 채널값→기본값.
    applyAdCost: false,
    adPct: c.adCostPct != null ? Number(c.adCostPct) : DEFAULT_AD_ROAS_RATE,
  }
}

/** ApiCh + 채널별 override → MatrixChannel — 채널 DB 값 기준, 화면 변경분 반영 */
function apiChToMatrixChannel(c: ApiCh, ov: ChOverride): MatrixChannel {
  const channelType = c.channelTypeDef?.isSalesChannel === false ? 'INTERNAL_TRANSFER' : null
  return {
    id: c.id,
    name: c.name,
    channelType,
    feeRates: [{ categoryName: '기본', ratePercent: ov.feePct }],
    vatIncludedInFee: ov.vatIncludedInFee,
    paymentFeeVatIncluded: ov.paymentFeeVatIncluded,
    paymentFeeIncluded: ov.paymentFeeIncluded,
    paymentFeePct: ov.paymentFeePct,
    applyAdCost: ov.applyAdCost,
    shippingFeeType: ov.shippingFeeType,
    shippingFee: ov.shippingFee,
    shippingFeePct: ov.shippingFeePct,
    // FIXED 배송비 임계값 매핑 (엔진: P>=threshold → shippingFee, else 0).
    //   항상무료 → 판매자 항상 부담(threshold=1)
    //   기준 설정 → 기준 이상 주문만 부담
    //   기준 미설정 → 항상 부담(threshold=1, 마켓 안전). PERCENT는 엔진이 threshold 무시.
    freeShippingThreshold:
      ov.shippingFeeType === 'PERCENT'
        ? null
        : ov.shippingFee > 0
          ? ov.freeShipping
            ? 1
            : ov.freeShippingThreshold && ov.freeShippingThreshold > 0
              ? ov.freeShippingThreshold
              : 1
          : null,
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
  maxCostRatio: 0.33,
}

/** 숫자 포맷 */
function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

/**
 * 채널 순서 드래그용 Sortable 래퍼 — useSortable(훅)는 map 내부 직접 호출 불가라
 * 렌더-프롭으로 refs만 제공하고, 기존 인라인 행 JSX·클로저는 그대로 유지한다.
 */
function SortableChannelItem({
  id,
  children,
}: {
  id: string
  children: (p: {
    setNodeRef: (el: HTMLElement | null) => void
    style: React.CSSProperties
    attributes: DraggableAttributes
    listeners: ReturnType<typeof useSortable>['listeners']
  }) => React.ReactNode
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
    zIndex: isDragging ? 10 : undefined,
  }
  return <>{children({ setNodeRef, style, attributes, listeners })}</>
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
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  suffix: string
  step?: number
  className?: string
  placeholder?: string
}) {
  return (
    <div className="relative flex items-center">
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        min={0}
        placeholder={placeholder}
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

type PricingQuickFlowProps = {
  /** 있으면 저장 시나리오를 불러와 편집 모드로 시작 (저장=덮어쓰기) */
  initialScenarioId?: string
  /** 있으면 신규 진입 시 해당 상품을 자동 선택 (scenarioId 없을 때만) */
  initialProductId?: string
  /** 신규 진입 생성 방식 (scenarioId·productId 없을 때만). 기본 'existing' */
  initialMode?: PricingSimMode
}

export function PricingQuickFlow({
  initialScenarioId,
  initialProductId,
  initialMode,
}: PricingQuickFlowProps = {}) {
  const router = useRouter()
  // 생성 방식 — 기존 상품 선택 vs 신규 상품 직접 입력. 상품 프리셀렉트는 항상 기존.
  const [mode, setMode] = useState<PricingSimMode>(
    initialProductId ? 'existing' : (initialMode ?? 'existing')
  )
  // 편집 대상 시나리오 (있으면 저장=PATCH 덮어쓰기, 없으면 POST 신규)
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(
    initialScenarioId ?? null
  )
  // 로드된 시나리오 이름/메모 (저장 다이얼로그 프리필)
  const [loadedName, setLoadedName] = useState('')
  const [loadedMemo, setLoadedMemo] = useState('')
  // 명시 진입(상세 편집/상품 프리셀렉트)은 임시저장 draft 비활성 — 의도한 내용을 draft가 덮지 않게
  const draftEnabled = !initialScenarioId && !initialProductId

  // ── 글로벌 설정 (초기 로드) ────────────────────────────────────────────────
  const [settings, setSettings] = useState<PricingFullSettings>(DEFAULT_SETTINGS)
  // 기본값 설정 다이얼로그 (상세 화면에서도 열기)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 서버 설정 로드 완료 여부 — 로드 전엔 기본값 설정 열기 차단(DEFAULT_SETTINGS로 실제 저장값 덮어쓰기 방지)
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  // ── 라이브 시뮬 설정 (세션 한정 override) ─────────────────────────────────
  const [live, setLive] = useState<LiveSim>(() => liveFromSettings(DEFAULT_SETTINGS))
  // 초기 settings 로드 완료 여부 — 임시저장 복원 시 async 로드가 복원값을 덮어쓰는 것 방지
  const settingsLoadedRef = useRef(false)
  // 복원 시 "다음 1회 settings→live 리셋 건너뛰기" 플래그 (초기 로드가 아직 안 끝났을 때만 arm)
  const skipNextLiveResetRef = useRef(false)
  // 설정이 새로 로드/저장되면 라이브값을 설정 기본값으로 리셋 (단, 복원 직후 1회는 건너뜀)
  useEffect(() => {
    if (skipNextLiveResetRef.current) {
      skipNextLiveResetRef.current = false
      return
    }
    setLive(liveFromSettings(settings))
  }, [settings])

  // 기본값 저장 → settings 반영. 단 live(좌측 슬라이더)는 리셋하지 않음(편집 중 시나리오 마진 보존).
  const handleDefaultsSaved = useCallback((s: PricingFullSettings) => {
    skipNextLiveResetRef.current = true
    setSettings(s)
  }, [])

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
          if (!cancelled) {
            setSettings(mapPricingSettings(d.settings))
            setSettingsLoaded(true) // 실제 서버값 로드 완료 → 기본값 설정 열기 허용
          }
        }
        if (chRes.ok) {
          const d: { channels?: ApiCh[] } = await chRes.json()
          if (!cancelled) setAllChannels(d.channels ?? [])
        }
      } catch {
        // 기본값 유지
      } finally {
        // 초기 로드 완료 — 이후 복원은 settings 리셋 걱정 없이 live를 직접 세팅
        if (!cancelled) settingsLoadedRef.current = true
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

  // 소비자가 override (시나리오 한정, 저장 대상). null=상품 기본 소비자가(totalRetail) 사용.
  // 판매가 상한을 이 값으로 조정 — 올리면 채널 판매가를 더 높게 조정 가능.
  const [retailOverride, setRetailOverride] = useState<number | null>(null)

  // 상품 기본 소비자가 (Σ 컴포넌트 retailPrice×수량). 0/미입력이면 null.
  const baseRetail =
    bundleCostSummary && bundleCostSummary.totalRetail > 0 ? bundleCostSummary.totalRetail : null
  // 유효 소비자가 = override 우선, 없으면 상품 기본값. 판매가 상한·할인율·원가율 표시의 단일 소스.
  const effectiveRetail = retailOverride ?? baseRetail

  // MatrixBundle 구성 (salePrice는 채널 카드에서 역산)
  const matrixBundle = useMemo<MatrixBundle | null>(() => {
    if (confirmedRows.length === 0) return null
    return {
      components: confirmedRows.map((r) => ({
        costPrice: r.costPrice,
        retailPrice: r.retailPrice,
        quantity: r.quantity,
      })),
      // 포장비 항목 제거 — 원가에 포함으로 간주(별도 비용 미반영)
      packagingCost: 0,
      salePrice: 0,
    }
  }, [confirmedRows])

  // ── 채널 선택 ─────────────────────────────────────────────────────────────
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])
  const [channelPickerId, setChannelPickerId] = useState<string>('')

  // 채널별 비용 override (세션 한정). 채널 DB 값에서 프리필, 화면에서 즉시 변경.
  const [chOverrides, setChOverrides] = useState<Record<string, ChOverride>>({})
  // 채널별 편집 영역 펼침 상태
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(() => new Set())

  // 채널별 판매가 수동조정값 (세션 한정, 시나리오 저장 대상). 채널 id → 원, null/미설정=권장가 자동.
  const [manualPrices, setManualPrices] = useState<Record<string, number | null>>({})
  const setChannelManualPrice = useCallback((channelId: string, v: number | null) => {
    setManualPrices((prev) => {
      if (v == null) {
        if (prev[channelId] == null) return prev
        const next = { ...prev }
        delete next[channelId]
        return next
      }
      return { ...prev, [channelId]: v }
    })
  }, [])

  // 채널 override 조회 — 미설정이면 채널 DB 값 + 설정 기본값에서 즉석 seed (렌더 순수성 유지)
  const overrideOf = useCallback(
    (c: ApiCh): ChOverride => chOverrides[c.id] ?? seedOverride(c, settings),
    [chOverrides, settings]
  )

  const setOverride = useCallback(
    (c: ApiCh, patch: Partial<ChOverride>) => {
      setChOverrides((prev) => ({
        ...prev,
        [c.id]: { ...(prev[c.id] ?? seedOverride(c, settings)), ...patch },
      }))
    },
    [settings]
  )

  const toggleExpanded = (id: string) => {
    setExpandedChannels((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 채널 순서 드래그(dnd-kit) — 핸들 전용, 6px 이동 후 활성(클릭 오작동 방지)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const handleChannelDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    // selectedChannelIds만 재정렬하면 좌측 목록·우측 마진 보드·스냅샷이 모두 자동 연동된다.
    setSelectedChannelIds((prev) => {
      const from = prev.indexOf(String(active.id))
      const to = prev.indexOf(String(over.id))
      if (from < 0 || to < 0) return prev
      return arrayMove(prev, from, to)
    })
  }

  const addChannel = (id: string, categoryName = '기본') => {
    if (!id || selectedChannelIds.includes(id)) return
    setSelectedChannelIds((prev) => [...prev, id])
    // 채널 추가 시 항상 현재 채널 관리 설정값으로 재시드한다(수수료·배송·PG·광고 최신 반영).
    // 저장 시나리오의 초기 채널은 applySnapshot이 동결 복원하지만, 사용자가 명시적으로
    // 추가하는 채널은 현재 채널 설정을 반영해야 한다. 이후 채널별 인라인 편집은 세션 유지.
    const c = allChannels.find((ch) => ch.id === id)
    if (c) setChOverrides((prev) => ({ ...prev, [id]: seedOverride(c, settings, categoryName) }))
    // 채널별 설정 편집 영역을 기본으로 펼쳐 바로 확인·조정 가능하게 한다
    setExpandedChannels((prev) => new Set(prev).add(id))
    setChannelPickerId('')
  }

  // 다중 수수료 카테고리 채널 추가 시 카테고리 선택 Dialog 대상 (null=닫힘)
  const [pendingChannel, setPendingChannel] = useState<ApiCh | null>(null)
  const [pendingCategory, setPendingCategory] = useState<string>('기본')

  // "채널 추가..." 선택 핸들러 — 다중 카테고리면 선택 Dialog, 아니면 즉시 추가
  const onPickChannel = (id: string) => {
    if (!id || selectedChannelIds.includes(id)) return
    const c = allChannels.find((ch) => ch.id === id)
    if (c && c.feeRates.length > 1) {
      setPendingChannel(c)
      setPendingCategory(
        c.feeRates.find((f) => f.categoryName === '기본')?.categoryName ??
          c.feeRates[0].categoryName
      )
    } else {
      addChannel(id)
    }
  }

  const removeChannel = (id: string) => {
    setSelectedChannelIds((prev) => prev.filter((c) => c !== id))
    // override도 함께 정리 — 재추가 시 stale 세션값이 남아 현재 채널 설정을 덮지 않도록.
    setChOverrides((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    // 수동 판매가도 정리 — 재추가 시 stale 세션값 방지
    setManualPrices((prev) => {
      if (prev[id] == null) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  // 가격 시뮬레이션 사용(useSimulation) 채널만 대상
  const simChannels = useMemo(
    () => allChannels.filter((c) => c.useSimulation !== false),
    [allChannels]
  )

  const selectedApiChannels = useMemo(
    () =>
      selectedChannelIds
        .map((id) => simChannels.find((c) => c.id === id))
        .filter((c): c is ApiCh => c != null),
    [selectedChannelIds, simChannels]
  )

  // 추가 가능한 채널 목록
  const availableChannels = useMemo(
    () => simChannels.filter((c) => !selectedChannelIds.includes(c.id)),
    [simChannels, selectedChannelIds]
  )

  // ── 프로모션 (채널별) ───────────────────────────────────────────────────────
  // 채널 id → PromotionValue. 미설정=프로모션 없음(NONE). manualPrices 패턴과 동형.
  const [chPromotions, setChPromotions] = useState<Record<string, PromotionValue>>({})
  const promotionOf = useCallback(
    (channelId: string): PromotionValue => chPromotions[channelId] ?? { type: 'NONE', value: 0 },
    [chPromotions]
  )
  const setChannelPromotion = useCallback((channelId: string, v: PromotionValue) => {
    setChPromotions((prev) => {
      if (v.type === 'NONE') {
        if (prev[channelId] == null) return prev
        const next = { ...prev }
        delete next[channelId]
        return next
      }
      return { ...prev, [channelId]: v }
    })
  }, [])
  // PromotionValue → 엔진 단위(MatrixPromotion). PERCENT는 % → 0~1.
  const toMatrixPromotion = useCallback(
    (p: PromotionValue): MatrixPromotion => ({
      type: p.type,
      value: p.type === 'PERCENT' ? p.value / 100 : p.value,
      minThreshold: p.minThreshold,
    }),
    []
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

  // 신규 상품 모드는 실제 옵션(optionIds)이 없어 판매채널 상품 자동 생성 불가
  const canCreate = mode === 'existing' && isSingleProduct && confirmedRows.length > 0
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
    setChOverrides({})
    setManualPrices({})
    setRetailOverride(null)
    setExpandedChannels(new Set())
    setChPromotions({})
    setLive(liveFromSettings(settings))
    setSnap(true)
    setRestorable(null)
    clearDraft()
    // 편집 모드 해제 — 초기화 후 저장은 원본 덮어쓰기가 아니라 새 시나리오여야 안전
    setEditingScenarioId(null)
    setLoadedName('')
    setLoadedMemo('')
    toast.success('시뮬레이션을 초기화했습니다')
  }

  // ── 우측 보드용 채널 + globals ─────────────────────────────────────────────
  const boardChannels = useMemo(
    () =>
      selectedApiChannels.map((c) => {
        const ov = overrideOf(c)
        return {
          api: c,
          adPct: ov.adPct,
          channel: apiChToMatrixChannel(c, ov),
        }
      }),
    [selectedApiChannels, overrideOf]
  )

  // KPI — 권장가 범위 + 소비자가 대비 할인율. 카드와 동일 역산(good) + 소비자가 상한 클램프.
  const boardSummary = useMemo(() => {
    if (!matrixBundle || boardChannels.length === 0) return null
    // 소비자가 상한 = 유효 소비자가(override 반영). 0/미입력이면 null → 클램프 없음.
    const retailCap = effectiveRetail
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
      if (good != null) {
        const snapped = snap ? snapPrice(good, 'end900') : Math.round(good)
        // 권장가는 소비자가를 초과할 수 없음(항목7). 상한 클램프 후 범위 산출.
        prices.push(retailCap != null ? Math.min(snapped, retailCap) : snapped)
      }
    }
    const min = prices.length ? Math.min(...prices) : null
    const max = prices.length ? Math.max(...prices) : null
    // 소비자가 대비 할인율 범위: 낮은 권장가=높은 할인. R 없으면 null.
    const discountMax =
      retailCap != null && min != null ? Math.max(0, (retailCap - min) / retailCap) : null
    const discountMin =
      retailCap != null && max != null ? Math.max(0, (retailCap - max) / retailCap) : null
    return {
      total: boardChannels.length,
      pass: prices.length,
      min,
      max,
      discountMin,
      discountMax,
    }
  }, [matrixBundle, boardChannels, live, tierThresholds, snap, effectiveRetail])

  // 채널별 "현재 설정된 판매가" 범위 — 보드 카드의 effectivePrice와 동일 로직
  // (adless 역산 권장가 → 소비자가 상한 클램프, 수동가 있으면 그 값(상한 클램프)). min~max.
  const setPriceRange = useMemo(() => {
    if (!matrixBundle || boardChannels.length === 0) return null
    const retailCap = effectiveRetail
    const prices: number[] = []
    for (const bc of boardChannels) {
      const adless = { ...bc.channel, applyAdCost: false }
      const m = calculateMatrix({
        bundle: { ...matrixBundle, salePrice: 0 },
        channel: adless,
        promotion: { type: 'NONE', value: 0 },
        globals: buildGlobals(live, bc.adPct),
        thresholds: tierThresholds,
      })
      const raw = m.recommendedRetail.good
      const recommended = raw != null && snap ? snapPrice(raw, 'end900') : raw
      const autoPrice =
        recommended != null && retailCap != null ? Math.min(recommended, retailCap) : recommended
      const manual = manualPrices[bc.api.id]
      const clampedManual =
        manual != null && retailCap != null ? Math.min(manual, retailCap) : manual
      const effective = clampedManual ?? autoPrice
      if (effective != null) prices.push(Math.round(effective))
    }
    const min = prices.length ? Math.min(...prices) : null
    const max = prices.length ? Math.max(...prices) : null
    return { min, max }
  }, [matrixBundle, boardChannels, live, tierThresholds, snap, effectiveRetail, manualPrices])

  // ── 스냅샷 직렬화 / 복원 ───────────────────────────────────────────────────
  // 선택 상품(대표 = 첫 확정행). 번들이면 productIds에 전부 담아 구성 상품 모두 조회 대상.
  // 신규 모드 행은 productId='' → filter(Boolean)로 제거해 빈 배열 유지
  // (['']로 저장 시 POST가 존재하지 않는 상품 검증 실패 → 저장 거부)
  const scenarioProductIds = useMemo(
    () => [...new Set(confirmedRows.map((r) => r.productId).filter(Boolean))],
    [confirmedRows]
  )

  const buildSnapshot = useCallback((): PricingSimSnapshot => {
    const chOverrides: Record<string, SnapChOverride> = {}
    const snapManualPrices: Record<string, number | null> = {}
    const snapPromotions: Record<string, PromotionValue> = {}
    for (const id of selectedChannelIds) {
      const c = allChannels.find((ch) => ch.id === id)
      if (c) chOverrides[id] = overrideOf(c)
      // 선택 채널의 수동 판매가만 담는다(제거된 채널의 stale 값 배제)
      if (manualPrices[id] != null) snapManualPrices[id] = manualPrices[id]
      // 선택 채널의 프로모션(NONE 아님)만 담는다
      const p = chPromotions[id]
      if (p && p.type !== 'NONE') snapPromotions[id] = p
    }
    const summary: PricingSimSummary = {
      productNames: [...new Set(confirmedRows.map((r) => r.productName))],
      channelCount: selectedChannelIds.length,
      targetMarginPct: Math.round(live.targetMargin * 100),
      priceMin: boardSummary?.min ?? null,
      priceMax: boardSummary?.max ?? null,
      totalCost: bundleCostSummary?.totalCost ?? 0,
      mode,
    }
    return {
      v: 1,
      mode,
      live,
      rows: confirmedRows,
      bundleNameInput,
      selectedChannelIds,
      chOverrides,
      manualPrices: snapManualPrices,
      retailOverride,
      chPromotions: snapPromotions,
      // 레거시 계약 충족(구 뷰어 안전). 실 복원 소스는 chPromotions.
      promotion: { type: 'NONE', value: 0 },
      snap,
      summary,
    }
  }, [
    mode,
    confirmedRows,
    selectedChannelIds,
    allChannels,
    overrideOf,
    live,
    boardSummary,
    bundleCostSummary,
    bundleNameInput,
    manualPrices,
    retailOverride,
    chPromotions,
    snap,
  ])

  const applySnapshot = useCallback((s: PricingSimSnapshot) => {
    // 초기 settings 로드가 아직이면, 뒤늦게 도착할 리셋 1회를 건너뛰도록 arm
    if (!settingsLoadedRef.current) skipNextLiveResetRef.current = true
    setMode(s.mode ?? 'existing')
    setLive(s.live)
    setRows(
      s.rows.length > 0
        ? s.rows.map((rc) => ({ id: nextRowId(), resolved: rc }))
        : [{ id: nextRowId(), resolved: null }]
    )
    setBundleNameInput(s.bundleNameInput)
    setSelectedChannelIds(s.selectedChannelIds)
    // 구 스냅샷 호환 — 무료배송 필드 기본값 채움
    const restoredOverrides: Record<string, ChOverride> = {}
    for (const [id, o] of Object.entries(s.chOverrides)) {
      restoredOverrides[id] = {
        ...o,
        // 구 스냅샷 호환 — 카테고리 미기록이면 '기본'. feePct·feeCategory 동결 복원(재시딩 금지)
        feeCategory: o.feeCategory ?? '기본',
        freeShipping: o.freeShipping ?? false,
        freeShippingThreshold: o.freeShippingThreshold ?? null,
        // 구 스냅샷 호환 — VAT 포함 여부 미기록이면 false(기본값=미포함)
        vatIncludedInFee: o.vatIncludedInFee ?? false,
        paymentFeeVatIncluded: o.paymentFeeVatIncluded ?? false,
      }
    }
    setChOverrides(restoredOverrides)
    setManualPrices(s.manualPrices ?? {})
    setRetailOverride(s.retailOverride ?? null)
    setExpandedChannels(new Set())
    // 프로모션 복원: 채널별(chPromotions) 우선, 없으면 레거시 전역 프로모션을 전 채널에 동일 적용
    if (s.chPromotions) {
      setChPromotions(s.chPromotions)
    } else if (s.promotion?.type !== 'NONE') {
      setChPromotions(Object.fromEntries(s.selectedChannelIds.map((id) => [id, s.promotion])))
    } else {
      setChPromotions({})
    }
    setSnap(s.snap)
  }, [])

  // ── 진입점 ①: 저장 시나리오 로드 (편집 모드) ──────────────────────────────
  useEffect(() => {
    if (!initialScenarioId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/sh/pricing-scenarios/${initialScenarioId}`)
        if (!res.ok) throw new Error()
        const data: {
          name: string
          memo: string | null
          snapshot: PricingSimSnapshot | null
        } = await res.json()
        if (cancelled) return
        if (data.snapshot) applySnapshot(data.snapshot)
        setLoadedName(data.name)
        setLoadedMemo(data.memo ?? '')
      } catch {
        if (!cancelled) toast.error('시나리오를 불러오지 못했습니다')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [initialScenarioId, applySnapshot])

  // ── 진입점 ②: 상품 자동 선택 (신규 + productId) ───────────────────────────
  useEffect(() => {
    if (!initialProductId || initialScenarioId) return
    let cancelled = false
    void (async () => {
      try {
        const [optRes, prodRes] = await Promise.all([
          fetch(`/api/sh/products/${initialProductId}/options`),
          fetch(`/api/sh/products/${initialProductId}`),
        ])
        if (!optRes.ok) return
        const optJson: {
          options: Array<{
            id: string
            name: string
            costPrice: string | number | null
            /** 생산차수 원가 연동 시 파생 원가 (아니면 costPrice와 동일) */
            effectiveCostPrice?: string | number | null
            retailPrice: string | number | null
            attributeValues?: Record<string, string> | null
            sizeLabel?: string | null
          }>
        } = await optRes.json()
        const options: OptionInput[] = (optJson.options ?? []).map((o) => ({
          optionId: o.id,
          optionName: o.name,
          costPrice:
            (o.effectiveCostPrice ?? o.costPrice) != null
              ? Number(o.effectiveCostPrice ?? o.costPrice)
              : null,
          retailPrice: o.retailPrice != null ? Number(o.retailPrice) : null,
          attributeValues: o.attributeValues ?? null,
          sizeLabel: o.sizeLabel ?? null,
        }))
        const grp = resolveFirstPriceGroup(options)
        if (!grp || cancelled) return
        let productName = ''
        if (prodRes.ok) {
          const p = await prodRes.json()
          productName = productDisplayName(p.product ?? p)
        }
        setRows([
          {
            id: nextRowId(),
            resolved: {
              productId: initialProductId,
              productName: productName || '선택한 상품',
              optionId: grp.optionId,
              optionIds: grp.optionIds,
              costPrice: grp.costPrice,
              retailPrice: grp.retailPrice,
              quantity: 1,
            },
          },
        ])
      } catch {
        // 무시 — 사용자가 직접 선택 가능
      }
    })()
    return () => {
      cancelled = true
    }
  }, [initialProductId, initialScenarioId])

  // ── 작성중 내용 자동 임시저장 (localStorage, debounce) ─────────────────────
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!draftEnabled) return
    const snapshot = buildSnapshot()
    // 빈/기본 상태는 저장 안 함 — 기존 임시저장을 빈 내용으로 덮어쓰지 않도록
    if (!isMeaningfulSnapshot(snapshot)) return
    draftTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(PRICING_DRAFT_KEY, JSON.stringify(snapshot))
      } catch {
        // 용량 초과 등 — 무시 (임시저장은 best-effort)
      }
    }, 500)
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    }
  }, [buildSnapshot, draftEnabled])

  const clearDraft = useCallback(() => {
    // 대기 중인 자동저장 타이머 취소 — 저장 직후 debounce가 draft를 되살리는 경쟁 방지
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    try {
      localStorage.removeItem(PRICING_DRAFT_KEY)
    } catch {
      // 무시
    }
  }, [])

  // ── 복원 배너 (mount 시 임시저장 감지) ────────────────────────────────────
  const [restorable, setRestorable] = useState<PricingSimSnapshot | null>(null)
  useEffect(() => {
    if (!draftEnabled) return
    try {
      const raw = localStorage.getItem(PRICING_DRAFT_KEY)
      if (!raw) return
      const s = parseSnapshot(JSON.parse(raw))
      if (s && isMeaningfulSnapshot(s)) setRestorable(s)
    } catch {
      // 파싱 실패 — 조용히 무시
    }
    // mount 1회만
  }, [draftEnabled])

  // ── 시나리오 저장 다이얼로그 ──────────────────────────────────────────────
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveMemo, setSaveMemo] = useState('')
  const [saving, setSaving] = useState(false)

  const openSaveDialog = () => {
    if (confirmedRows.length === 0) {
      toast.error('저장할 상품을 먼저 선택해 주세요')
      return
    }
    setSaveName(editingScenarioId ? loadedName : bundleName)
    setSaveMemo(editingScenarioId ? loadedMemo : '')
    setSaveOpen(true)
  }

  // asNew=true면 편집 중이어도 새 시나리오로 저장(POST)
  const handleSaveScenario = async (asNew = false) => {
    const name = saveName.trim()
    if (!name) {
      toast.error('시나리오 이름을 입력해 주세요')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name,
        memo: saveMemo.trim() || undefined,
        productIds: scenarioProductIds,
        inputSnapshot: buildSnapshot(),
      }
      const headers = { 'Content-Type': 'application/json' }
      if (editingScenarioId && !asNew) {
        // 덮어쓰기
        const res = await fetch(`/api/sh/pricing-scenarios/${editingScenarioId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.message ?? data?.error ?? '저장 실패')
        toast.success('시나리오를 저장했습니다')
        setLoadedName(name)
        setLoadedMemo(saveMemo.trim())
        setSaveOpen(false)
      } else {
        // 신규 생성
        const res = await fetch('/api/sh/pricing-scenarios', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.message ?? data?.error ?? '저장 실패')
        toast.success('시나리오를 저장했습니다')
        clearDraft()
        setRestorable(null)
        setSaveOpen(false)
        // 저장된 시나리오 상세(편집 모드)로 이동
        if (data.id) {
          setEditingScenarioId(data.id)
          router.replace(getSellerHubPricingScenarioPath(data.id))
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  // ─── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <div className="ps-root">
      {/* ── 임시저장 복원 배너 ── */}
      {restorable && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-emerald-600" />
            <span>
              작성 중이던 내용이 있습니다
              {restorable.summary.productNames.length > 0 && (
                <span className="ml-1 text-muted-foreground">
                  ({restorable.summary.productNames.join(', ')})
                </span>
              )}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7"
              onClick={() => {
                applySnapshot(restorable)
                setRestorable(null)
                toast.success('작성 중이던 내용을 복원했습니다')
              }}
            >
              이어서 작성
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => {
                setRestorable(null)
                clearDraft()
              }}
            >
              새로 시작
            </Button>
          </div>
        </div>
      )}

      {/* ── 목록으로 돌아가기 ── */}
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="mb-3 -ml-2 gap-1 px-2 text-muted-foreground hover:text-foreground"
      >
        <Link href={SELLER_HUB_PRICING_SIM_PATH}>
          <ArrowLeft className="h-4 w-4" /> 시나리오 목록
        </Link>
      </Button>

      {/* ── 헤더 ── */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">가격 시뮬레이션</h1>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setSettingsOpen(true)}
            disabled={!settingsLoaded}
          >
            <Settings2 className="h-3.5 w-3.5" /> 기본값 설정
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={handleReset}
          >
            <RotateCcw className="h-3.5 w-3.5" /> 초기화
          </Button>
          <Button type="button" size="sm" className="h-8 gap-1.5" onClick={openSaveDialog}>
            <Save className="h-3.5 w-3.5" /> 시나리오 저장
          </Button>
        </div>
      </div>

      {/* ── KPI 스트립 (순서: 원가매입 → 소비자가 → 판매가 → 할인율) ── */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCell
          label="원가 · 매입"
          value={bundleCostSummary ? `₩${fmt(bundleCostSummary.totalCost)}` : '—'}
          valueRight={
            bundleCostSummary && effectiveRetail != null && effectiveRetail > 0
              ? (() => {
                  const rate = Math.round((bundleCostSummary.totalCost / effectiveRetail) * 100)
                  const high = rate > Math.round(settings.maxCostRatio * 100) // 상한 초과 = 원가율 높음(주의)
                  return (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                        high ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'
                      )}
                    >
                      {high && <AlertTriangle className="h-3 w-3" />}
                      원가율 {rate}%
                    </span>
                  )
                })()
              : undefined
          }
          tooltip={
            confirmedRows.length > 0 ? (
              <div className="space-y-1">
                <p className="font-medium">원가 항목별 (원가율)</p>
                {confirmedRows.map((r, i) => {
                  const cost = r.costPrice * r.quantity
                  const retail = r.retailPrice * r.quantity
                  const pct = retail > 0 ? Math.round((cost / retail) * 100) : null
                  return (
                    <p key={i} className="flex justify-between gap-3 tabular-nums">
                      <span className="truncate text-muted-foreground">
                        {r.productName}
                        {r.quantity > 1 ? ` ×${r.quantity}` : ''}
                      </span>
                      <span>
                        ₩{fmt(cost)}
                        {pct != null && <span className="text-muted-foreground"> ({pct}%)</span>}
                      </span>
                    </p>
                  )
                })}
              </div>
            ) : undefined
          }
        />
        <RetailKpiCell
          base={baseRetail}
          effective={effectiveRetail}
          override={retailOverride}
          editable={mode === 'existing' && baseRetail != null}
          onChange={setRetailOverride}
        />
        <KpiCell
          label="판매가"
          value={
            setPriceRange && setPriceRange.min != null && setPriceRange.max != null
              ? setPriceRange.min === setPriceRange.max
                ? `₩${fmt(setPriceRange.min)}`
                : `${fmt(setPriceRange.min)}~${fmt(setPriceRange.max)}`
              : '—'
          }
          tooltip="채널별로 현재 설정된 판매가(수동 조정 시 그 값, 아니면 권장가) 범위입니다."
        />
        <KpiCell
          label="소비자가 대비 할인율"
          value={
            boardSummary && boardSummary.discountMin != null && boardSummary.discountMax != null
              ? boardSummary.discountMin === boardSummary.discountMax
                ? `${Math.round(boardSummary.discountMax * 100)}%`
                : `${Math.round(boardSummary.discountMin * 100)}~${Math.round(boardSummary.discountMax * 100)}%`
              : '—'
          }
        />
      </div>

      {/* 기본값 설정 다이얼로그 (헤더 버튼으로 열기) — 서버 로드 완료 후에만 렌더(DEFAULT_SETTINGS 저장 방지) */}
      {settingsLoaded && (
        <PricingDefaultsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialSettings={settings}
          onSaved={handleDefaultsSaved}
        />
      )}

      {/* ── 본문 2단 ── */}
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* ── 좌측: 스텝 패널 ── */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {/* ① 상품 선택 */}
          <StepCard
            step={1}
            title={mode === 'new' ? '상품 설정' : '상품 선택'}
            badge={
              mode === 'new'
                ? confirmedRows.length > 0
                  ? confirmedRows[0].productName
                  : '미입력'
                : confirmedRows.length > 0
                  ? bundleName
                  : '미선택'
            }
          >
            {mode === 'new' ? (
              /* ── 신규 상품: 원가·소비자가 직접 입력 (단일 상품) ── */
              <ManualProductRow
                resolved={rows[0]?.resolved ?? null}
                onChange={(c) => handleRowChange(rows[0].id, c)}
              />
            ) : (
              <>
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
              </>
            )}
          </StepCard>

          {/* ② 시뮬레이션 설정 — 이 시나리오에만 적용(세션 한정). 기본값 편집은 목록 화면에서. */}
          <StepCard step={2} title="시뮬레이션 설정">
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
                tooltip="켜면 판매가에 VAT가 포함된 것으로 봅니다. 순이익 = 공급가(=판매가÷(1+VAT)) − 비용. 마진율(%) 분모는 실결제금액(판매가)이라 VAT가 마진율 감소로 반영됩니다. 수수료·광고·PG는 판매가 기준."
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
                tooltip="전체 주문 대비 반품 비율. 반품 비용 = 반품 처리비 × 반품율 (매출 차감이 아니라 건당 처리비만 비용에 반영)."
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
                tooltip="반품 1건당 왕복 물류·검수 비용. 반품 비용 = 반품 처리비 × 반품율 로 반영합니다."
              >
                <SuffixInput
                  value={String(live.returnHandling)}
                  onChange={(v) => setLiveField('returnHandling', Number(v) || 0)}
                  suffix="₩"
                  step={100}
                  className="w-24"
                />
              </FieldRow>

              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                배송비·PG·광고비·수수료율은 ③ 판매채널에서 채널별로 설정합니다. 원가·물류비·반품
                처리비 등 모든 비용 입력은 VAT 제외(공급가) 기준입니다.
              </p>
            </TooltipProvider>
          </StepCard>

          {/* ③ 판매채널 */}
          <StepCard step={3} title="판매채널" badge={`${selectedChannelIds.length}개 선택`}>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleChannelDragEnd}
            >
              <SortableContext items={selectedChannelIds} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {boardChannels.map((bc) => {
                    const ov = overrideOf(bc.api)
                    const open = expandedChannels.has(bc.api.id)
                    return (
                      <SortableChannelItem key={bc.api.id} id={bc.api.id}>
                        {({ setNodeRef, style, attributes, listeners }) => (
                          <div
                            ref={setNodeRef}
                            style={style}
                            {...attributes}
                            className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-card)]"
                          >
                            <div className="flex items-center gap-2 px-3 py-2">
                              <button
                                type="button"
                                {...listeners}
                                className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
                                aria-label={`${bc.api.name} 순서 변경`}
                              >
                                <GripVertical className="h-4 w-4" />
                              </button>
                              <span className="text-emerald-600" aria-hidden>
                                ✓
                              </span>
                              <div className="min-w-0 flex-1">
                                <span className="text-sm font-medium">{bc.api.name}</span>
                                <span className="ml-1.5 text-[10px] text-muted-foreground">
                                  {ov.feeCategory !== '기본' ? `[${ov.feeCategory}] ` : ''}수수료{' '}
                                  {ov.feePct.toFixed(1)}% (
                                  {ov.vatIncludedInFee ? 'VAT 포함' : 'VAT 별도'}) · 배송{' '}
                                  {ov.shippingFeeType === 'PERCENT'
                                    ? `${(ov.shippingFeePct * 100).toFixed(1)}%`
                                    : `₩${fmt(ov.shippingFee)}`}
                                  {ov.applyAdCost && ov.adPct > 0
                                    ? ` · ROAS ${Math.round(100 / ov.adPct)}%`
                                    : ''}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleExpanded(bc.api.id)}
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={`${bc.api.name} 채널별 비용 설정`}
                                aria-expanded={open}
                              >
                                <ChevronDown
                                  className={cn(
                                    'h-4 w-4 transition-transform',
                                    open && 'rotate-180'
                                  )}
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeChannel(bc.api.id)}
                                className="text-muted-foreground hover:text-destructive"
                                aria-label={`${bc.api.name} 제거`}
                                title="채널 제거"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                            {open && (
                              <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[var(--ps-border)] px-3 py-2.5">
                                {bc.api.feeRates.length > 1 && (
                                  <label className="col-span-2 space-y-1">
                                    <span className="text-[10px] text-muted-foreground">
                                      수수료 카테고리
                                    </span>
                                    <Select
                                      value={ov.feeCategory}
                                      onValueChange={(name) => {
                                        const row = bc.api.feeRates.find(
                                          (f) => f.categoryName === name
                                        )
                                        setOverride(bc.api, {
                                          feeCategory: name,
                                          feePct: row ? Number(row.ratePercent) || 0 : ov.feePct,
                                        })
                                      }}
                                    >
                                      <SelectTrigger className="h-8 text-sm">
                                        <SelectValue placeholder="카테고리 선택..." />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {bc.api.feeRates.map((f) => (
                                          <SelectItem key={f.categoryName} value={f.categoryName}>
                                            {f.categoryName} · {Number(f.ratePercent).toFixed(1)}%
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </label>
                                )}
                                <label className="space-y-1">
                                  <span className="text-[10px] text-muted-foreground">
                                    카테고리 수수료율
                                  </span>
                                  <SuffixInput
                                    value={String(ov.feePct)}
                                    onChange={(v) =>
                                      setOverride(bc.api, { feePct: Number(v) || 0 })
                                    }
                                    suffix="%"
                                    step={0.1}
                                    className="w-full"
                                  />
                                </label>
                                <label className="space-y-1">
                                  <span className="flex items-center justify-between text-[10px] text-muted-foreground">
                                    <span>배송비</span>
                                    <button
                                      type="button"
                                      className="rounded border border-[var(--ps-border)] px-1 text-[9px] hover:bg-[var(--ps-muted)]"
                                      onClick={() =>
                                        setOverride(bc.api, {
                                          shippingFeeType:
                                            ov.shippingFeeType === 'PERCENT' ? 'FIXED' : 'PERCENT',
                                        })
                                      }
                                    >
                                      {ov.shippingFeeType === 'PERCENT' ? '비율 %' : '정액 ₩'}
                                    </button>
                                  </span>
                                  {ov.shippingFeeType === 'PERCENT' ? (
                                    <SuffixInput
                                      value={String(Math.round(ov.shippingFeePct * 1000) / 10)}
                                      onChange={(v) =>
                                        setOverride(bc.api, {
                                          shippingFeePct: (Number(v) || 0) / 100,
                                        })
                                      }
                                      suffix="%"
                                      step={0.1}
                                      className="w-full"
                                    />
                                  ) : (
                                    <SuffixInput
                                      value={String(ov.shippingFee)}
                                      onChange={(v) =>
                                        setOverride(bc.api, { shippingFee: Number(v) || 0 })
                                      }
                                      suffix="₩"
                                      step={100}
                                      className="w-full"
                                    />
                                  )}
                                </label>
                                {/* 무료배송 (FIXED 전용) — 기준 이상 주문은 판매자 배송비 부담 */}
                                {ov.shippingFeeType === 'FIXED' && (
                                  <div className="col-span-2 flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] text-muted-foreground">
                                        무료배송 기준{ov.freeShipping ? ' (항상무료)' : ''}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {!ov.freeShipping && (
                                        <SuffixInput
                                          value={
                                            ov.freeShippingThreshold
                                              ? String(ov.freeShippingThreshold)
                                              : ''
                                          }
                                          onChange={(v) =>
                                            setOverride(bc.api, {
                                              freeShippingThreshold:
                                                Number(v) > 0 ? Number(v) : null,
                                            })
                                          }
                                          suffix="₩"
                                          step={1000}
                                          placeholder="미설정"
                                          className="w-24"
                                        />
                                      )}
                                      <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-muted-foreground">
                                          항상무료
                                        </span>
                                        <Switch
                                          checked={ov.freeShipping}
                                          onCheckedChange={(v) =>
                                            setOverride(bc.api, { freeShipping: v })
                                          }
                                        />
                                      </div>
                                    </div>
                                  </div>
                                )}
                                <div className="col-span-2 flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-muted-foreground">
                                    PG 결제수수료
                                    {ov.paymentFeeIncluded ? ' (채널수수료에 포함)' : ''}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    {!ov.paymentFeeIncluded && (
                                      <SuffixInput
                                        value={String(Math.round(ov.paymentFeePct * 1000) / 10)}
                                        onChange={(v) =>
                                          setOverride(bc.api, {
                                            paymentFeePct: (Number(v) || 0) / 100,
                                          })
                                        }
                                        suffix="%"
                                        step={0.1}
                                        className="w-20"
                                      />
                                    )}
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] text-muted-foreground">
                                        별도 부과
                                      </span>
                                      <Switch
                                        checked={!ov.paymentFeeIncluded}
                                        onCheckedChange={(v) =>
                                          setOverride(bc.api, { paymentFeeIncluded: !v })
                                        }
                                      />
                                    </div>
                                  </div>
                                </div>
                                {/* 광고 ROAS는 채널별 마진 보드에서 조정(판매가 순환 인플레 방지) */}
                              </div>
                            )}
                          </div>
                        )}
                      </SortableChannelItem>
                    )
                  })}
                </div>
              </SortableContext>
            </DndContext>
            {availableChannels.length > 0 && (
              <Select value={channelPickerId} onValueChange={onPickChannel}>
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
              채널에 설정된 값에서 시작합니다. ▾를 눌러 이 시뮬레이션에만 적용할 값으로 변경할 수
              있습니다.
            </p>
          </StepCard>
          {/* 다중 수수료 카테고리 채널 추가 — 카테고리 선택 Dialog */}
          <Dialog open={pendingChannel != null} onOpenChange={(o) => !o && setPendingChannel(null)}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>수수료 카테고리 선택</DialogTitle>
                <DialogDescription>
                  {pendingChannel?.name} 채널에 수수료 항목이 여러 개입니다. 이 시뮬레이션에 적용할
                  카테고리를 선택하세요. (추가 후에도 변경 가능)
                </DialogDescription>
              </DialogHeader>
              <div className="py-1">
                <Select value={pendingCategory} onValueChange={setPendingCategory}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="카테고리 선택..." />
                  </SelectTrigger>
                  <SelectContent>
                    {pendingChannel?.feeRates.map((f) => (
                      <SelectItem key={f.categoryName} value={f.categoryName}>
                        {f.categoryName} · {Number(f.ratePercent).toFixed(1)}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setPendingChannel(null)}>
                  취소
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (pendingChannel) addChannel(pendingChannel.id, pendingCategory)
                    setPendingChannel(null)
                  }}
                >
                  추가
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {/* 프로모션은 우측 채널별 마진 보드 카드에서 채널별로 설정 */}
        </div>

        {/* ── 우측: 채널별 마진 보드 ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">채널별 마진 보드</h2>
            <div className="flex items-center gap-3">
              <TooltipProvider delayDuration={200}>
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>
                    끝자리 올림
                    <HelpTip text="권장 판매가의 끝자리를 900으로 올려 표시합니다(예: 32,350원 → 32,900원). 마진 계산에는 영향이 없고 표시 가격만 정돈하는 심리적 가격 기능입니다." />
                  </span>
                  <Switch checked={snap} onCheckedChange={setSnap} />
                </label>
              </TooltipProvider>
              <span className="text-[11px] text-muted-foreground">실시간 갱신</span>
            </div>
          </div>

          {matrixBundle && boardChannels.length > 0 ? (
            <div className="space-y-4">
              {boardChannels.map((bc) => (
                <PricingChannelBoardCard
                  key={bc.api.id}
                  channel={bc.channel}
                  bundle={matrixBundle}
                  adPct={bc.adPct}
                  promotion={toMatrixPromotion(promotionOf(bc.api.id))}
                  promotionValue={promotionOf(bc.api.id)}
                  onPromotionChange={(v) => setChannelPromotion(bc.api.id, v)}
                  globals={buildGlobals(live, bc.adPct)}
                  thresholds={tierThresholds}
                  snap={snap}
                  onCreate={(ch, price) => setConfirmTarget({ channel: ch, price })}
                  creating={creatingChannelId === bc.api.id}
                  canCreate={canCreate}
                  onAdChange={(patch) => setOverride(bc.api, patch)}
                  manualPrice={manualPrices[bc.api.id] ?? null}
                  onManualPriceChange={(v) => setChannelManualPrice(bc.api.id, v)}
                  retailCap={effectiveRetail}
                />
              ))}
              {mode === 'new' ? (
                <p className="text-center text-[11px] text-muted-foreground">
                  신규 상품은 등록된 옵션이 없어 판매채널 상품 자동 생성을 지원하지 않습니다.
                </p>
              ) : (
                confirmedRows.length > 1 &&
                !isSingleProduct && (
                  <p className="text-center text-[11px] text-muted-foreground">
                    다중 상품 번들은 판매채널 상품 자동 생성을 지원하지 않습니다 (단일 상품만 가능).
                  </p>
                )
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-card)] px-4 py-16 text-center text-sm text-muted-foreground">
              상품과 판매채널을 선택하면 채널별 권장가와 마진 구성이 여기에 표시됩니다.
            </div>
          )}
        </div>
      </div>

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

      {/* 시나리오 저장 다이얼로그 */}
      <Dialog open={saveOpen} onOpenChange={(v) => !saving && setSaveOpen(v)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingScenarioId ? '시나리오 저장 (덮어쓰기)' : '시나리오 저장'}
            </DialogTitle>
            <DialogDescription>
              현재 시뮬레이션 구성(상품·채널·마진·프로모션)을 저장합니다.
              {editingScenarioId
                ? ' 기존 시나리오를 덮어쓰거나 새 시나리오로 저장할 수 있습니다.'
                : ' 저장된 시나리오는 목록과 상품 상세에서 다시 불러올 수 있습니다.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="scenario-name" className="text-xs">
                시나리오 이름
              </Label>
              <Input
                id="scenario-name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={bundleName || '예: 여름 프로모션 기준'}
                className="h-9"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="scenario-memo" className="text-xs">
                메모 (선택)
              </Label>
              <Textarea
                id="scenario-memo"
                value={saveMemo}
                onChange={(e) => setSaveMemo(e.target.value)}
                placeholder="가정·목적 등 메모"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSaveOpen(false)}
              disabled={saving}
            >
              취소
            </Button>
            {editingScenarioId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSaveScenario(true)}
                disabled={saving}
              >
                새 시나리오로 저장
              </Button>
            )}
            <Button size="sm" onClick={() => handleSaveScenario()} disabled={saving}>
              {saving ? '저장 중...' : editingScenarioId ? '덮어쓰기' : '저장'}
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
  tooltip,
  valueRight,
}: {
  label: string
  value: string
  sub?: string
  accent?: 'emerald'
  /** 값에 hover 시 상세 설명 (예: 원가 항목별 내역) */
  tooltip?: React.ReactNode
  /** 값 우측 인라인 배지 (예: 원가율) */
  valueRight?: React.ReactNode
}) {
  const valueEl = (
    <p
      className={cn(
        'mt-0.5 text-xl font-bold tabular-nums',
        accent === 'emerald' && 'text-emerald-700',
        tooltip && 'w-fit cursor-default underline decoration-dotted underline-offset-2'
      )}
    >
      {value}
    </p>
  )
  return (
    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-card)] px-4 py-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="flex items-baseline justify-between gap-2">
        {tooltip ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>{valueEl}</TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px] text-xs">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          valueEl
        )}
        {valueRight}
      </div>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

/**
 * 소비자가 KPI — 편집 가능(기존 상품 모드). override 시 상품 기본 소비자가를 비교 표시.
 * 판매가 상한이 이 값으로 조정됨(올리면 채널 판매가를 더 높게 조정 가능).
 */
function RetailKpiCell({
  base,
  effective,
  override,
  editable,
  onChange,
}: {
  /** 상품 기본 소비자가 (Σ 컴포넌트). null=미입력 */
  base: number | null
  /** 유효 소비자가 (override ?? base) */
  effective: number | null
  /** override 값 (null=기본값 사용) */
  override: number | null
  /** 편집 가능 여부 (기존 모드 + 기본값 존재) */
  editable: boolean
  onChange: (v: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const startEdit = () => {
    if (!editable) return
    setDraft(effective != null ? String(Math.round(effective)) : '')
    setEditing(true)
  }
  const commit = () => {
    const v = Number(draft)
    // 기본값과 같거나 비우면 override 해제(기본값 복귀). 0/음수도 해제.
    onChange(v > 0 && v !== base ? v : null)
    setEditing(false)
  }

  return (
    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-card)] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">소비자가</p>
        {override != null && (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => onChange(null)}
          >
            <RotateCcw className="h-3 w-3" />
            기본값
          </button>
        )}
      </div>
      {editing ? (
        <div className="relative mt-0.5 flex items-center">
          <Input
            type="number"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
            step={100}
            min={0}
            className="h-8 w-full [appearance:textfield] pr-6 text-right text-lg font-bold tabular-nums [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="pointer-events-none absolute right-2 text-xs text-muted-foreground">
            ₩
          </span>
        </div>
      ) : (
        <p
          className={cn(
            'mt-0.5 text-xl font-bold text-emerald-700 tabular-nums',
            editable && 'w-fit cursor-pointer underline decoration-dotted underline-offset-2'
          )}
          onClick={startEdit}
          title={editable ? '클릭해 소비자가 변경' : undefined}
        >
          {effective != null ? `₩${fmt(effective)}` : '—'}
        </p>
      )}
      {override != null && base != null && (
        <p className="text-[10px] text-muted-foreground tabular-nums">기본 ₩{fmt(base)}</p>
      )}
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
