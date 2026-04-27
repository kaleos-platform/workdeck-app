'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  BarChart2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GitCompare,
  Save,
  Settings2,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

import { PricingOptionPickerDialog, type PricingOption } from './pricing-option-picker-dialog'
import { PricingManualEntryDialog, type ManualEntryData } from './pricing-manual-entry-dialog'
import { PricingComparisonDialog } from './pricing-comparison-dialog'
import { PricingDefaultsDialog, type PricingFullSettings } from './pricing-defaults-dialog'
import { PricingPromotionCard, type PromotionValue } from './pricing-promotion-card'
import { PricingChannelList, type ScenarioChannel, type DbChannel } from './pricing-channel-list'
import { PricingMatrix } from './pricing-matrix'
import { PricingMarginAdvisor, type AdvisorChannelEntry } from './pricing-margin-advisor'
import { PricingSensitivityChart } from './pricing-sensitivity-chart'
import { DebouncedNumInput } from './debounced-num-input'
import { calculateMatrix } from '@/lib/sh/pricing-matrix-calc'
import type { MatrixGlobals, MatrixOption, MatrixChannel } from '@/lib/sh/pricing-matrix-calc'
import type { TierThresholds } from '@/lib/sh/margin-tier'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

type ScenarioSummary = {
  id: string
  name: string
  memo: string | null
  channel: { id: string; name: string } | null
  includeVat: boolean
  vatRate: number
  itemCount: number
  totalNetProfit: number
  averageMargin: number
  updatedAt: string
}

/** 시나리오 상세 (GET 응답) — 채널 spec 대응 */
type ScenarioDetail = ScenarioSummary & {
  promotionType?: string
  promotionValue?: number | null
  applyReturnAdjustment?: boolean
  /** bernstein API spec: PricingScenarioChannel[] { channel, channelInline }
   * 현재 API는 channel[] 로 반환 — 점진적 호환 */
  channels?: (DbChannel | null)[]
  items: {
    id: string
    optionId: string | null
    manualName?: string | null
    manualBrandName?: string | null
    unitsPerSet?: number
    costPrice: number | null
    salePrice: number
    packagingCost: number
    option: {
      id: string
      name: string
      sku: string | null
      costPrice: number | null
      retailPrice: number | null
      product: {
        id: string
        name: string
        brand: { id: string; name: string } | null
      }
    } | null
  }[]
}

/** 옵션 행 (시뮬레이션용 — pricing-items-table 구조에서 매트릭스용으로 전환) */
type OptionRow = {
  rowId: string
  // DB 연결 옵션 (optionId null이면 수동 입력 행)
  optionId: string | null
  productId: string | null
  optionName: string
  productName: string
  brandName: string | null
  // 수동 입력 전용 필드 (optionId가 null일 때 사용)
  manualName?: string | null
  manualBrandName?: string | null
  // 매트릭스 입력값
  costPrice: number
  retailPrice: number // 1세트 판매가
  unitsPerSet: number
  packagingCost: number
  /** 소비자가(MSRP) — DB 옵션은 option.msrp, 수동 입력은 직접 입력값. 세션 전용 (DB 미저장) */
  consumerPrice: number | null
  // UI 상태
  matrixExpanded: Record<string, boolean> // channelKey → 펼침 여부
  chartExpanded: Record<string, boolean> // channelKey → 민감도 차트 펼침 여부
}

type DefaultSettings = {
  defaultOperatingCostPct: number // 0~100
  defaultAdCostPct: number // 0~100
  defaultPackagingCost: number
}

type FullSettings = DefaultSettings &
  Partial<TierThresholds> & {
    expectedReturnRate?: number
    returnHandlingCost?: number
    minimumAcceptableMargin?: number
  }

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function makeRowId() {
  return Math.random().toString(36).slice(2, 10)
}

function fmt(n: number) {
  return Math.round(n).toLocaleString('ko-KR')
}

function buildRowFromOption(opt: PricingOption, defaults: DefaultSettings): OptionRow {
  return {
    rowId: makeRowId(),
    optionId: opt.optionId,
    productId: opt.productId,
    optionName: opt.optionName,
    productName: opt.productName,
    brandName: opt.brandName,
    costPrice: opt.costPrice ?? 0,
    retailPrice: 0,
    unitsPerSet: 1,
    packagingCost: defaults.defaultPackagingCost,
    consumerPrice: opt.msrp ?? null,
    matrixExpanded: {},
    chartExpanded: {},
  }
}

function buildRowFromManualEntry(entry: ManualEntryData, defaults: DefaultSettings): OptionRow {
  return {
    rowId: makeRowId(),
    optionId: null,
    productId: null,
    optionName: '',
    productName: entry.manualName,
    brandName: entry.manualBrandName || null,
    manualName: entry.manualName,
    manualBrandName: entry.manualBrandName || null,
    costPrice: entry.costPrice,
    retailPrice: entry.retailPrice,
    unitsPerSet: entry.unitsPerSet,
    packagingCost: defaults.defaultPackagingCost,
    consumerPrice: entry.consumerPrice ?? null,
    matrixExpanded: {},
    chartExpanded: {},
  }
}

/** ScenarioChannel → MatrixChannel 변환 */
function toMatrixChannel(sc: ScenarioChannel): MatrixChannel {
  if (sc.source === 'db') {
    const ch = sc.channel
    return {
      id: ch.id,
      name: ch.name,
      channelType: ch.channelType,
      defaultFeePct: ch.defaultFeePct ?? 0,
      paymentFeeIncluded: ch.paymentFeeIncluded,
      paymentFeePct: ch.paymentFeePct ?? 0,
      applyAdCost: ch.applyAdCost,
      shippingFee: ch.shippingFee ?? 0,
      freeShippingThreshold: ch.freeShippingThreshold ?? null,
    }
  } else {
    const il = sc.inline
    return {
      name: il.name,
      channelType: il.channelType,
      defaultFeePct: il.defaultFeePct,
      paymentFeeIncluded: il.paymentFeeIncluded,
      paymentFeePct: il.paymentFeePct,
      applyAdCost: il.applyAdCost,
      shippingFee: il.shippingFee,
      freeShippingThreshold: il.freeShippingThreshold > 0 ? il.freeShippingThreshold : null,
    }
  }
}

/** ScenarioChannel 고유 키 */
function channelKey(sc: ScenarioChannel, idx: number): string {
  return sc.source === 'db' ? `db-${sc.channelId}` : `inline-${idx}`
}

/** PromotionValue → MatrixPromotion 변환 (PERCENT: value를 0~1로) */
function toMatrixPromotion(p: PromotionValue) {
  return {
    type: p.type,
    value: p.type === 'PERCENT' ? p.value / 100 : p.value,
  }
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function PricingSimMain() {
  const nameId = useId()
  const memoId = useId()

  // ── 시나리오 목록 ──────────────────────────────────────────────────────────
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const [scenariosLoading, setScenariosLoading] = useState(true)
  const [comparisonOpen, setComparisonOpen] = useState(false)

  // ── 현재 시나리오 메타 ────────────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [nameAuto, setNameAuto] = useState(true)
  const [memo, setMemo] = useState('')
  const [includeVat, setIncludeVat] = useState(true)
  const [vatRatePct, setVatRatePct] = useState(10)
  const [applyReturnAdjustment, setApplyReturnAdjustment] = useState(false)

  // ── 전체 DB 채널 캐시 (시나리오 복원용) ────────────────────────────────────
  const [allDbChannels, setAllDbChannels] = useState<DbChannel[]>([])

  // ── 채널 배열 (신규 M-N 구조) ─────────────────────────────────────────────
  const [scenarioChannels, setScenarioChannels] = useState<ScenarioChannel[]>([])

  // ── 프로모션 ──────────────────────────────────────────────────────────────
  const [promotion, setPromotion] = useState<PromotionValue>({ type: 'NONE', value: 0 })

  // ── 옵션 행 ───────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<OptionRow[]>([])

  // ── 설정 ──────────────────────────────────────────────────────────────────
  const [defaults, setDefaults] = useState<DefaultSettings>({
    defaultOperatingCostPct: 0,
    defaultAdCostPct: 0,
    defaultPackagingCost: 0,
  })
  const [fullSettings, setFullSettings] = useState<FullSettings>({
    defaultOperatingCostPct: 0,
    defaultAdCostPct: 0,
    defaultPackagingCost: 0,
    selfMallTargetGood: 0.35,
    selfMallTargetFair: 0.25,
    platformTargetGood: 0.25,
    platformTargetFair: 0.15,
    expectedReturnRate: 0.05,
    returnHandlingCost: 5000,
    minimumAcceptableMargin: 0.1,
  })

  // ── UI ────────────────────────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false)
  const [manualEntryOpen, setManualEntryOpen] = useState(false)
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 마진 어드바이저 펼침 상태 — rowId → boolean (기본 접힘) */
  const [advisorExpanded, setAdvisorExpanded] = useState<Record<string, boolean>>({})

  // ── 초기 로드 ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [scenRes, stRes, chRes] = await Promise.all([
          fetch('/api/sh/pricing-scenarios?pageSize=100'),
          fetch('/api/sh/settings'),
          fetch('/api/channels?isActive=true'),
        ])
        if (scenRes.ok) {
          const d: { data: ScenarioSummary[] } = await scenRes.json()
          setScenarios(d.data ?? [])
        }
        if (chRes.ok) {
          // API는 Decimal 필드를 string으로 반환 — number로 변환
          type ApiCh = {
            id: string
            name: string
            channelType: string | null
            kind: string | null
            defaultFeePct: string | number | null
            shippingFee: string | number | null
            freeShippingThreshold: string | number | null
            applyAdCost: boolean
            paymentFeeIncluded: boolean
            paymentFeePct: string | number | null
          }
          const d: { channels?: ApiCh[] } = await chRes.json()
          setAllDbChannels(
            (d.channels ?? []).map(
              (c): DbChannel => ({
                id: c.id,
                name: c.name,
                channelType: c.channelType,
                kind: c.kind,
                defaultFeePct: c.defaultFeePct != null ? Number(c.defaultFeePct) : null,
                shippingFee: c.shippingFee != null ? Number(c.shippingFee) : null,
                freeShippingThreshold:
                  c.freeShippingThreshold != null ? Number(c.freeShippingThreshold) : null,
                applyAdCost: c.applyAdCost,
                paymentFeeIncluded: c.paymentFeeIncluded,
                paymentFeePct: c.paymentFeePct != null ? Number(c.paymentFeePct) : null,
              })
            )
          )
        }
        if (stRes.ok) {
          const d: { settings: Partial<FullSettings> } = await stRes.json()
          if (d.settings) {
            const s = d.settings
            const base: DefaultSettings = {
              defaultOperatingCostPct: Number(s.defaultOperatingCostPct ?? 0) || 0,
              defaultAdCostPct: Number(s.defaultAdCostPct ?? 0) || 0,
              defaultPackagingCost: Number(s.defaultPackagingCost ?? 0) || 0,
            }
            setDefaults(base)
            setFullSettings((prev) => ({
              ...prev,
              ...base,
              selfMallTargetGood: Number(s.selfMallTargetGood ?? prev.selfMallTargetGood),
              selfMallTargetFair: Number(s.selfMallTargetFair ?? prev.selfMallTargetFair),
              platformTargetGood: Number(s.platformTargetGood ?? prev.platformTargetGood),
              platformTargetFair: Number(s.platformTargetFair ?? prev.platformTargetFair),
              expectedReturnRate: Number(s.expectedReturnRate ?? prev.expectedReturnRate),
              returnHandlingCost: Number(s.returnHandlingCost ?? prev.returnHandlingCost),
              minimumAcceptableMargin: Number(
                s.minimumAcceptableMargin ?? prev.minimumAcceptableMargin
              ),
            }))
          }
        }
      } finally {
        setScenariosLoading(false)
      }
    }
    loadAll()
  }, [])

  // ── 시나리오 로드 ──────────────────────────────────────────────────────────

  const loadScenario = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/sh/pricing-scenarios/${id}`)
        if (!res.ok) throw new Error('시나리오 로드 실패')
        const data: ScenarioDetail = await res.json()

        setActiveId(data.id)
        setName(data.name)
        setNameAuto(false)
        setMemo(data.memo ?? '')
        setIncludeVat(data.includeVat)
        setVatRatePct(Math.round(data.vatRate * 100))
        setApplyReturnAdjustment(data.applyReturnAdjustment ?? false)
        setPromotion({
          type: (data.promotionType as PromotionValue['type']) ?? 'NONE',
          // PERCENT: API는 0~1, UI는 0~100
          value:
            data.promotionType === 'PERCENT'
              ? (data.promotionValue ?? 0) * 100
              : (data.promotionValue ?? 0),
        })

        // 채널 복원 — API GET은 channel: { id, name }만 반환 (부분 데이터)
        // allDbChannels 캐시에서 전체 데이터를 조회해 복원
        const apiChannels = (data.channels ?? []).filter(Boolean) as { id: string; name: string }[]
        const restored: ScenarioChannel[] = apiChannels.map((partial) => {
          // 캐시에서 전체 채널 데이터 조회
          const full = allDbChannels.find((c) => c.id === partial.id)
          if (full) {
            return { source: 'db' as const, channelId: full.id, channel: full }
          }
          // 캐시 미스 — 부분 데이터로 폴백 (수수료 0, 배송비 0으로 표시됨)
          const fallback: DbChannel = {
            id: partial.id,
            name: partial.name,
            channelType: null,
            kind: null,
            defaultFeePct: null,
            shippingFee: null,
            freeShippingThreshold: null,
            applyAdCost: false,
            paymentFeeIncluded: true,
            paymentFeePct: null,
          }
          return { source: 'db' as const, channelId: partial.id, channel: fallback }
        })
        setScenarioChannels(restored)

        // 옵션 행 복원 — DB 옵션 행과 수동 입력 행(option=null, manualName!=null) 모두 포함
        const loadedRows: OptionRow[] = data.items
          .filter((it) => it.option !== null || (it.manualName ?? null) !== null)
          .map((it) => {
            if (it.option !== null) {
              // DB 옵션 행 — msrp는 API GET에서 option.msrp로 제공됨
              const opt = it.option as typeof it.option & { msrp?: number | null }
              return {
                rowId: makeRowId(),
                optionId: it.optionId,
                productId: it.option!.product.id,
                optionName: it.option!.name,
                productName: it.option!.product.name,
                brandName: it.option!.product.brand?.name ?? null,
                costPrice: it.costPrice ?? it.option!.costPrice ?? 0,
                retailPrice: it.salePrice,
                unitsPerSet: it.unitsPerSet ?? 1,
                packagingCost: it.packagingCost,
                consumerPrice: opt.msrp ?? null,
                matrixExpanded: {},
                chartExpanded: {},
              }
            } else {
              // 수동 입력 행 — consumerPrice는 DB에 없으므로 null로 복원
              const mn = it.manualName ?? ''
              return {
                rowId: makeRowId(),
                optionId: null,
                productId: null,
                optionName: '',
                productName: mn,
                brandName: it.manualBrandName ?? null,
                manualName: mn,
                manualBrandName: it.manualBrandName ?? null,
                costPrice: it.costPrice ?? 0,
                retailPrice: it.salePrice,
                unitsPerSet: it.unitsPerSet ?? 1,
                packagingCost: it.packagingCost,
                consumerPrice: null,
                matrixExpanded: {},
                chartExpanded: {},
              }
            }
          })
        setRows(loadedRows)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '시나리오 로드 실패')
      }
    },
    [allDbChannels]
  )

  // ── 새 시나리오로 리셋 ─────────────────────────────────────────────────────

  function resetToNew() {
    setActiveId(null)
    setName('')
    setNameAuto(true)
    setMemo('')
    setIncludeVat(true)
    setVatRatePct(10)
    setApplyReturnAdjustment(false)
    setPromotion({ type: 'NONE', value: 0 })
    setScenarioChannels([])
    setRows([])
  }

  // ── 시나리오명 자동 추천 ───────────────────────────────────────────────────

  useEffect(() => {
    if (!nameAuto || activeId !== null || rows.length === 0) return
    const firstRow = rows[0]
    // 수동 입력 행은 manualName, DB 행은 productName 사용
    const displayName = firstRow.manualName ?? firstRow.productName
    let suggested = displayName
    if (firstRow.brandName) suggested = `${firstRow.brandName} ${suggested}`
    if (rows.length > 1) suggested += ` 외 ${rows.length - 1}개`
    const firstCh = scenarioChannels[0]
    if (firstCh?.source === 'db') suggested = `${firstCh.channel.name} · ${suggested}`
    else if (firstCh?.source === 'inline') suggested = `${firstCh.inline.name} · ${suggested}`
    Promise.resolve().then(() => setName(suggested))
  }, [rows, scenarioChannels, nameAuto, activeId])

  // ── 옵션 추가 ─────────────────────────────────────────────────────────────

  function handlePickOption(opt: PricingOption) {
    setRows((prev) => {
      if (prev.some((r) => r.optionId === opt.optionId)) return prev
      return [...prev, buildRowFromOption(opt, defaults)]
    })
  }

  function handleAddManual(entry: ManualEntryData) {
    setRows((prev) => [...prev, buildRowFromManualEntry(entry, defaults)])
  }

  function updateRow(rowId: string, patch: Partial<OptionRow>) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)))
  }

  function removeRow(rowId: string) {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId))
  }

  function toggleMatrix(rowId: string, key: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r
        return {
          ...r,
          matrixExpanded: { ...r.matrixExpanded, [key]: !r.matrixExpanded[key] },
        }
      })
    )
  }

  function toggleChart(rowId: string, key: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r
        return {
          ...r,
          chartExpanded: { ...r.chartExpanded, [key]: !r.chartExpanded[key] },
        }
      })
    )
  }

  // ── MatrixGlobals 빌드 ─────────────────────────────────────────────────────

  const matrixGlobals: MatrixGlobals = {
    includeVat,
    vatRate: vatRatePct / 100,
    adCostPct: (fullSettings.defaultAdCostPct ?? 0) / 100,
    operatingCostPct: (fullSettings.defaultOperatingCostPct ?? 0) / 100,
    applyReturnAdjustment,
    expectedReturnRate: fullSettings.expectedReturnRate ?? 0.05,
    returnHandlingCost: fullSettings.returnHandlingCost ?? 5000,
    minimumAcceptableMargin: fullSettings.minimumAcceptableMargin ?? 0.1,
  }

  const tierThresholds: TierThresholds = {
    selfMallTargetGood: fullSettings.selfMallTargetGood ?? 0.35,
    selfMallTargetFair: fullSettings.selfMallTargetFair ?? 0.25,
    platformTargetGood: fullSettings.platformTargetGood ?? 0.25,
    platformTargetFair: fullSettings.platformTargetFair ?? 0.15,
  }

  // ── 저장 ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!name.trim()) {
      toast.error('시나리오명을 입력하세요')
      return
    }
    if (rows.length === 0) {
      toast.error('옵션을 1개 이상 추가하세요')
      return
    }

    setSaving(true)
    try {
      // 채널 페이로드 — spec: channels: [{ channelId } | { channelInline }]
      // 현재 API(channelIds: string[])와 spec 양쪽 병행 전송.
      // bernstein이 spec 페이로드를 지원하면 channelIds 제거 예정.
      const channelIds = scenarioChannels
        .filter((c): c is Extract<ScenarioChannel, { source: 'db' }> => c.source === 'db')
        .map((c) => c.channelId)

      const channelPayload = scenarioChannels.map((sc) =>
        sc.source === 'db' ? { channelId: sc.channelId } : { channelInline: sc.inline }
      )

      const body = {
        name: name.trim(),
        memo: memo.trim() || undefined,
        includeVat,
        vatRate: vatRatePct / 100,
        promotionType: promotion.type,
        promotionValue: promotion.type === 'PERCENT' ? promotion.value / 100 : promotion.value,
        applyReturnAdjustment,
        channelIds, // 현재 API 호환 (DB 채널만)
        channels: channelPayload, // spec 페이로드 (bernstein API 업데이트 후 활성화)
        items: rows.map((r, idx) => ({
          optionId: r.optionId,
          // 수동 입력 행: manualName/manualBrandName 포함 (schema refine 통과 조건)
          manualName: r.optionId == null ? (r.manualName ?? null) : undefined,
          manualBrandName: r.optionId == null ? (r.manualBrandName ?? null) : undefined,
          costPrice: r.costPrice,
          salePrice: r.retailPrice,
          unitsPerSet: r.unitsPerSet,
          // 포장비는 글로벌 기본값 사용 (옵션별 편집 UI 제거됨)
          packagingCost: defaults.defaultPackagingCost,
          // 채널별 수수료는 매트릭스에서 채널 설정으로 계산하므로 항목 레벨은 0으로 전송
          discountRate: 0,
          channelFeePct: 0,
          shippingCost: 0,
          adCostPct: (fullSettings.defaultAdCostPct ?? 0) / 100,
          operatingCostPct: (fullSettings.defaultOperatingCostPct ?? 0) / 100,
          sortOrder: idx,
        })),
      }

      let savedId = activeId

      if (activeId) {
        const res = await fetch(`/api/sh/pricing-scenarios/${activeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err?.error ?? '저장 실패')
        }
        toast.success('시나리오가 업데이트되었습니다')
      } else {
        const res = await fetch('/api/sh/pricing-scenarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err?.error ?? '저장 실패')
        }
        const created: { id: string } = await res.json()
        savedId = created.id
        setActiveId(created.id)
        toast.success('시나리오가 저장되었습니다')
      }

      const listRes = await fetch('/api/sh/pricing-scenarios?pageSize=100')
      if (listRes.ok) {
        const d: { data: ScenarioSummary[] } = await listRes.json()
        setScenarios(d.data ?? [])
      }
      if (savedId) await loadScenario(savedId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  // ── 삭제 ──────────────────────────────────────────────────────────────────

  function handleDeleteClick() {
    if (!activeId) return
    if (!deleteConfirm) {
      setDeleteConfirm(true)
      deleteTimerRef.current = setTimeout(() => setDeleteConfirm(false), 3000)
      return
    }
    clearTimeout(deleteTimerRef.current ?? undefined)
    setDeleteConfirm(false)
    doDelete()
  }

  async function doDelete() {
    if (!activeId) return
    try {
      const res = await fetch(`/api/sh/pricing-scenarios/${activeId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제 실패')
      toast.success('시나리오가 삭제되었습니다')
      setScenarios((prev) => prev.filter((s) => s.id !== activeId))
      resetToNew()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  const existingOptionIds = rows.map((r) => r.optionId).filter((id): id is string => id != null)

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── 상단 툴바 ── */}
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="min-w-[240px] justify-between"
              disabled={scenariosLoading}
            >
              <span className="truncate">
                {activeId
                  ? (scenarios.find((s) => s.id === activeId)?.name ?? '시나리오')
                  : name.trim()
                    ? `${name} (저장 안 됨)`
                    : '+ 새 시나리오'}
              </span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64">
            <DropdownMenuItem onClick={resetToNew}>
              <span className="text-muted-foreground">+ 새 시나리오</span>
            </DropdownMenuItem>
            {scenarios.length > 0 && <DropdownMenuSeparator />}
            {scenarios.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onClick={() => loadScenario(s.id)}
                className="flex flex-col items-start gap-0.5"
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">
                  {s.itemCount}개 · 순수익 {fmt(s.totalNetProfit)}원 · 마진{' '}
                  {(s.averageMargin * 100).toFixed(1)}%
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

        <Button
          onClick={() => setDefaultsOpen(true)}
          variant="outline"
          className="max-w-[420px] gap-2"
        >
          <Settings2 className="h-4 w-4 shrink-0" />
          <span className="shrink-0 text-sm">기본값</span>
          <span className="truncate text-xs text-muted-foreground">
            광고 {fullSettings.defaultAdCostPct}% · 운영 {fullSettings.defaultOperatingCostPct}% ·
            포장 {fmt(fullSettings.defaultPackagingCost)}원
          </span>
        </Button>

        {scenarios.length >= 2 && (
          <Button variant="outline" size="sm" onClick={() => setComparisonOpen(true)}>
            <GitCompare className="mr-1.5 h-4 w-4" />
            비교
          </Button>
        )}

        {activeId && (
          <Button
            variant={deleteConfirm ? 'destructive' : 'ghost'}
            size="sm"
            onClick={handleDeleteClick}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            {deleteConfirm ? '정말 삭제?' : '삭제'}
          </Button>
        )}

        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save className="mr-1.5 h-4 w-4" />
          {saving ? '저장 중...' : activeId ? '업데이트' : '저장'}
        </Button>
      </div>

      {/* ── 시나리오 정보 (통합 카드) ── */}
      <Card>
        <CardContent className="space-y-4 pt-4 pb-4">
          {/* Row 1: 시나리오명 · VAT · 반품 */}
          <div className="flex flex-wrap items-start gap-3">
            {/* 시나리오명 */}
            <div className="min-w-[200px] flex-1 space-y-1">
              <Label htmlFor={nameId} className="text-xs">
                시나리오명 *
                {nameAuto && rows.length > 0 && (
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">(자동)</span>
                )}
              </Label>
              <Input
                id={nameId}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameAuto(false)
                }}
                placeholder="예: 쿠팡 여름 프로모션"
                maxLength={100}
                className="h-8 text-sm"
              />
            </div>

            {/* VAT */}
            <div className="space-y-1">
              <Label className="text-xs">부가세(VAT)</Label>
              <div className="flex h-8 items-center gap-2">
                <Switch
                  checked={includeVat}
                  onCheckedChange={setIncludeVat}
                  aria-label="VAT 포함 여부"
                />
                <span className="text-xs text-muted-foreground">
                  {includeVat ? '포함' : '미포함'}
                </span>
                {includeVat && (
                  <div className="relative flex items-center">
                    <Input
                      type="number"
                      value={vatRatePct}
                      onChange={(e) => setVatRatePct(Number(e.target.value))}
                      min={0}
                      max={100}
                      className="h-8 w-16 [appearance:textfield] pr-6 text-right text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="pointer-events-none absolute right-2 text-xs text-muted-foreground">
                      %
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 반품률 반영 토글 */}
            <div className="space-y-1">
              <Label className="text-xs">반품률 반영</Label>
              <div className="flex h-8 items-center gap-2">
                <Switch
                  checked={applyReturnAdjustment}
                  onCheckedChange={setApplyReturnAdjustment}
                  aria-label="반품률 반영 여부"
                />
                <span className="text-xs text-muted-foreground">
                  {applyReturnAdjustment
                    ? `반영 (${((fullSettings.expectedReturnRate ?? 0.05) * 100).toFixed(0)}%)`
                    : '미반영'}
                </span>
              </div>
            </div>
          </div>

          {/* Row 2: 프로모션 · 채널 (2-col 그리드, 작은 화면에서 스택) */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PricingPromotionCard value={promotion} onChange={setPromotion} embedded />
            <PricingChannelList
              channels={scenarioChannels}
              onChange={setScenarioChannels}
              onChannelRegistered={(ch) =>
                setAllDbChannels((prev) =>
                  prev.some((c) => c.id === ch.id) ? prev : [...prev, ch]
                )
              }
              embedded
            />
          </div>

          {/* Row 3: 메모 */}
          <div className="space-y-1">
            <Label htmlFor={memoId} className="text-xs">
              메모 (선택)
            </Label>
            <Textarea
              id={memoId}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="참고 사항"
              maxLength={500}
              rows={1}
              className="resize-none text-xs"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── 옵션 카드 목록 ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">옵션 ({rows.length}개)</h2>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
              + 옵션 추가
            </Button>
            <Button size="sm" variant="outline" onClick={() => setManualEntryOpen(true)}>
              + 수동 입력
            </Button>
          </div>
        </div>

        {rows.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12 text-center">
            <p className="text-sm text-muted-foreground">추가된 옵션이 없습니다</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
                옵션 추가
              </Button>
              <Button size="sm" variant="outline" onClick={() => setManualEntryOpen(true)}>
                수동 입력
              </Button>
            </div>
          </div>
        )}

        {rows.map((row) => (
          <Card key={row.rowId}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                {/* 한 줄: 상품명 · 옵션명 · 브랜드 배지 */}
                <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  {row.optionId == null ? (
                    // 수동 입력 행 — manualName이 상품명 역할
                    <>
                      <h3 className="truncate text-sm font-semibold">{row.manualName}</h3>
                      {row.manualBrandName && (
                        <Badge variant="secondary" className="ml-1 shrink-0 text-[10px]">
                          {row.manualBrandName}
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className="shrink-0 px-1.5 py-0 text-[10px] text-muted-foreground"
                      >
                        수동 입력
                      </Badge>
                    </>
                  ) : (
                    // DB 옵션 행 — 상품명 · 옵션명 inline
                    <>
                      <h3 className="truncate text-sm font-semibold">{row.productName}</h3>
                      {row.optionName && (
                        <span className="truncate text-sm text-muted-foreground">
                          · {row.optionName}
                        </span>
                      )}
                      {row.brandName && (
                        <Badge variant="secondary" className="ml-1 shrink-0 text-[10px]">
                          {row.brandName}
                        </Badge>
                      )}
                    </>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRow(row.rowId)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-2">
              {/* 이 옵션 행의 공통 matrixOption — 아래 어드바이저·매트릭스·차트에서 공유 */}
              {(() => {
                const rowMatrixOption: MatrixOption = {
                  optionId: row.optionId,
                  name: row.optionName,
                  retailPrice: row.retailPrice,
                  costPrice: row.costPrice,
                  unitsPerSet: row.unitsPerSet,
                  // 포장비는 글로벌 기본값에서 읽음 (옵션별 편집 UI 없음)
                  packagingCost: defaults.defaultPackagingCost,
                }
                const advisorChannels: AdvisorChannelEntry[] = scenarioChannels.map(
                  (sc, chIdx) => ({
                    key: channelKey(sc, chIdx),
                    name: sc.source === 'db' ? sc.channel.name : sc.inline.name,
                    channel: toMatrixChannel(sc),
                  })
                )
                const matrixPromotion = toMatrixPromotion(promotion)

                // 소비자가 대비 할인율 계산
                const discountVsConsumer =
                  row.consumerPrice != null &&
                  row.consumerPrice > 0 &&
                  row.retailPrice > 0 &&
                  row.retailPrice < row.consumerPrice
                    ? Math.round(((row.consumerPrice - row.retailPrice) / row.consumerPrice) * 100)
                    : null

                return (
                  <>
                    {/* 옵션 입력 필드 — 3컬럼 (포장비는 기본값에서 글로벌 적용) */}
                    <div className="flex flex-wrap gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">공급가 (원)</Label>
                        <DebouncedNumInput
                          value={row.costPrice}
                          onCommit={(v) => updateRow(row.rowId, { costPrice: v })}
                          suffix="원"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">판매가 / 1세트 (원)</Label>
                        <DebouncedNumInput
                          value={row.retailPrice}
                          onCommit={(v) => updateRow(row.rowId, { retailPrice: v })}
                          suffix="원"
                        />
                        {/* 소비자가 대비 할인율 헬퍼 텍스트 */}
                        {discountVsConsumer !== null ? (
                          <p className="text-[11px] text-blue-600">
                            소비자가 {fmt(row.consumerPrice!)}원 대비 {discountVsConsumer}% 할인
                          </p>
                        ) : row.consumerPrice != null && row.consumerPrice > 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            소비자가 {fmt(row.consumerPrice)}원
                          </p>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">
                          1세트 = N개
                          {row.unitsPerSet > 1 && (
                            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                              (1개당{' '}
                              {row.retailPrice > 0 ? fmt(row.retailPrice / row.unitsPerSet) : '—'}
                              원)
                            </span>
                          )}
                        </Label>
                        <DebouncedNumInput
                          value={row.unitsPerSet}
                          onCommit={(v) =>
                            updateRow(row.rowId, { unitsPerSet: Math.max(1, Math.round(v)) })
                          }
                          step={1}
                          min={1}
                        />
                      </div>
                    </div>

                    {/* 마진 어드바이저 — 기본 접힘, 버튼으로 토글 */}
                    <div>
                      <button
                        type="button"
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          setAdvisorExpanded((prev) => ({
                            ...prev,
                            [row.rowId]: !prev[row.rowId],
                          }))
                        }
                      >
                        {advisorExpanded[row.rowId] ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        마진 조언 {advisorExpanded[row.rowId] ? '숨기기' : '보기'}
                      </button>
                      {advisorExpanded[row.rowId] && (
                        <div className="mt-2">
                          <PricingMarginAdvisor
                            option={rowMatrixOption}
                            channels={advisorChannels}
                            promotion={matrixPromotion}
                            globals={matrixGlobals}
                            thresholds={tierThresholds}
                          />
                        </div>
                      )}
                    </div>

                    {/* 채널별 매트릭스 */}
                    {scenarioChannels.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        채널을 추가하면 할인율 매트릭스가 표시됩니다.
                      </p>
                    )}

                    {scenarioChannels.map((sc, chIdx) => {
                      const key = channelKey(sc, chIdx)
                      const isExpanded = row.matrixExpanded[key] !== false // 기본 펼침
                      const isChartExpanded = row.chartExpanded[key] === true // 기본 접힘
                      const chName = sc.source === 'db' ? sc.channel.name : sc.inline.name
                      const chType =
                        sc.source === 'db' ? sc.channel.channelType : sc.inline.channelType
                      const matrixChannel = toMatrixChannel(sc)

                      // 민감도 차트용 매트릭스 — 차트가 열려있을 때만 계산
                      const sensitivityMatrix =
                        isChartExpanded && row.retailPrice > 0
                          ? calculateMatrix({
                              option: rowMatrixOption,
                              channel: matrixChannel,
                              promotion: matrixPromotion,
                              globals: matrixGlobals,
                              thresholds: tierThresholds,
                            })
                          : null

                      return (
                        <div key={key} className="rounded-md border">
                          {/* 채널 헤더 */}
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
                            onClick={() => toggleMatrix(row.rowId, key)}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            <span className="text-sm font-medium">{chName}</span>
                            {chType && (
                              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                                {chType}
                              </Badge>
                            )}
                            {sc.source === 'inline' && (
                              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                임시
                              </Badge>
                            )}
                          </button>

                          {/* 매트릭스 테이블 */}
                          {isExpanded && (
                            <div className="space-y-2 border-t px-1 py-2">
                              <PricingMatrix
                                option={rowMatrixOption}
                                channel={matrixChannel}
                                promotion={matrixPromotion}
                                globals={matrixGlobals}
                                thresholds={tierThresholds}
                              />

                              {/* 민감도 차트 토글 버튼 */}
                              {row.retailPrice > 0 && (
                                <div className="flex justify-end">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 gap-1 text-xs text-muted-foreground"
                                    onClick={() => toggleChart(row.rowId, key)}
                                  >
                                    <BarChart2 className="h-3.5 w-3.5" />
                                    {isChartExpanded ? '차트 숨기기' : '민감도 차트'}
                                  </Button>
                                </div>
                              )}

                              {/* 민감도 차트 — isChartExpanded일 때만 렌더 */}
                              {isChartExpanded && sensitivityMatrix && (
                                <PricingSensitivityChart
                                  matrix={sensitivityMatrix}
                                  channelName={chName}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </>
                )
              })()}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── 비교 다이얼로그 ── */}
      {rows.length > 0 && scenarioChannels.length > 0 && (
        <>
          <Separator />
          <p className="text-center text-xs text-muted-foreground">
            옵션 {rows.length}개 × 채널 {scenarioChannels.length}개 — 매트릭스{' '}
            {rows.length * scenarioChannels.length}개
          </p>
        </>
      )}

      <PricingComparisonDialog
        open={comparisonOpen}
        onOpenChange={setComparisonOpen}
        scenarios={scenarios}
      />

      <PricingOptionPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={handlePickOption}
        excludeOptionIds={existingOptionIds}
      />

      <PricingManualEntryDialog
        open={manualEntryOpen}
        onOpenChange={setManualEntryOpen}
        onAdd={handleAddManual}
      />

      {/* ── 기본값 설정 다이얼로그 ── */}
      <PricingDefaultsDialog
        open={defaultsOpen}
        onOpenChange={setDefaultsOpen}
        initialSettings={fullSettings as PricingFullSettings}
        onSaved={(saved) => {
          // 3-field defaults (used for buildRowFromOption)
          setDefaults({
            defaultOperatingCostPct: saved.defaultOperatingCostPct,
            defaultAdCostPct: saved.defaultAdCostPct,
            defaultPackagingCost: saved.defaultPackagingCost,
          })
          // 전체 설정 (매트릭스 임계값 등)
          setFullSettings((prev) => ({
            ...prev,
            ...saved,
            // FullSettings의 반품 필드명과 PricingFullSettings 필드명 매핑
            expectedReturnRate: saved.defaultReturnRate,
            returnHandlingCost: saved.defaultReturnShipping,
          }))
        }}
      />
    </div>
  )
}
