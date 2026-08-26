'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, HelpCircle, Loader2, MapPinIcon, PackageIcon, PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { OptionPickerDialog } from '@/components/sh/products/listings/option-picker-dialog'
import {
  Bar,
  Kpi,
  Panel,
  PlanSummaryBar,
  StepBar,
  StepNav,
  fmtQty,
  fmtWon,
  type WizardStep,
} from './reorder-ui'

// dryRun 미리보기(POST /reorder/plan { dryRun:true }) 응답 — 생성과 동일 코드 경로라 drift 없음.
type PreviewOption = {
  optionId: string
  productId: string
  optionName: string
  sku: string | null
  productName: string
  costPrice: number | null
  currentStock: number // = onHandStock + incomingQty (plannedStock)
  onHandStock: number
  incomingQty: number
  safetyStockQty: number
  dailyAvgForecast: number
  leadTimeDays: number
  analysisWindowDays: number
  suggestedQty: number
  roundedSuggestedQty: number
  rocketBaselineQty: number | null // 연동 위치 입고 필요 수량. 비연동 = null.
  directGrossQty: number | null // 나머지 입고 수량. 비연동 = null.
  linkedLocationExpectedSalesQty: number | null // 로켓그로스 예상 판매 필요량(예측 일평균 × 리드타임 × 보정).
  linkedLocationSafetyStockQty: number | null // 로켓그로스 판매 비중으로 배분한 안전재고 반영분.
  linkedLocationNeedQty: number | null // 최종 발주 수량 cap 적용 전 로켓그로스 위치 부족분.
  linkedLocationCurrentStockQty: number | null // 로켓그로스 현재 재고.
  linkedLocationIncomingQty: number | null // 로켓그로스 입고 예정 수량.
  finalQty: number // 기본 최종수량 = 연동 위치 입고분 + 나머지 입고분
}
type PreviewSet = {
  listingId: string
  listingName: string
  currentSetStock: number
  finalSetQty: number
  items: { optionId: string; perSet: number }[]
}
type Preview = {
  isLayered: boolean
  qualifies: boolean // 상품이 연동 위치 로켓 세트로 팔림
  locationName: string | null
  options: PreviewOption[]
  sets: PreviewSet[]
}

type PickedProduct = { productId: string; productName: string; brandName: string | null }
type LinkedLocation = { id: string; name: string; externalSource: string | null; isActive: boolean }

// 상품 선택 후 순차 단계. 프로토타입 IA를 따라 외부 연동 / 자체 출고 / 수량 계산 / 검토로 분리한다.
const STEPS: WizardStep[] = [
  { id: 'product', label: '상품 선택', hint: '발주 대상' },
  { id: 'external', label: '외부 연동 확인', hint: '연동 위치 입고' },
  { id: 'own', label: '자체 출고 확인', hint: '나머지 위치' },
  { id: 'calc', label: '수량 계산', hint: '리드타임·보정계수' },
  { id: 'review', label: '세트 환산 · 검토', hint: '계획 생성' },
]
const STEP_PRODUCT = 0
const STEP_EXTERNAL = 1
const STEP_OWN = 2
const STEP_CALC = 3
const STEP_REVIEW = 4

type Props = {
  /** 생성 모드 진입 시 상품 선택 팝업을 자동으로 연다 */
  autoOpen?: boolean
  /** (호환) 부모의 "계획 목록으로" 버튼 사용 — 여기선 호출하지 않음 */
  onCancel?: () => void
  /**
   * 실적 모니터링 탭에서 넘어온 추가 보정계수(delta).
   * 자동 bias 보정 위에 곱해지는 값이므로 1이 "추가 보정 없음"이다.
   */
  initialDemandAdjust?: number
}

/**
 * 발주 계획 생성 — 상품 우선 순차 위저드 (5-step).
 *
 * ① 상품 선택 (OptionPickerDialog)
 * ② 외부 연동 확인 — 자동 감지된 로켓 세트 baseline 표시(읽기전용) + 포함 여부 토글
 * ③ 자체 출고 확인 — 나머지 위치 수요 소계 (외부 연동과 비교)
 * ④ 수량 계산 — 리드타임·보정계수 조정 + 옵션별 최종수량 편집
 * ⑤ 세트 환산 · 검토 → POST 생성 → 상세. 생산 등록은 상세의 "생산차수 생성"(기존).
 *
 * 미리보기는 POST { dryRun:true } 로 생성과 동일 계산을 받아 표시값=생성값 정합.
 */
export function ReorderPlanCreate({ autoOpen = true, initialDemandAdjust }: Props) {
  const router = useRouter()
  const [pickerOpen, setPickerOpen] = useState(autoOpen)
  const [picked, setPicked] = useState<PickedProduct | null>(null)
  const [stepIdx, setStepIdx] = useState(STEP_PRODUCT)
  const [reached, setReached] = useState(STEP_PRODUCT)

  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [includeRocket, setIncludeRocket] = useState(true)
  const [linkedLocations, setLinkedLocations] = useState<LinkedLocation[]>([])
  const [selectedLinkedLocationIds, setSelectedLinkedLocationIds] = useState<string[]>([])
  const [locationsLoading, setLocationsLoading] = useState(false)
  // 옵션별 편집 최종수량(문자열 — 입력 중 빈값 허용). 미리보기 로드 시 finalQty 로 초기화.
  const [finalByOption, setFinalByOption] = useState<Record<string, string>>({})
  const [leadTimeInput, setLeadTimeInput] = useState('')
  const [demandAdjustInput, setDemandAdjustInput] = useState(
    initialDemandAdjust != null ? String(initialDemandAdjust) : '1'
  )
  const [creating, setCreating] = useState(false)
  // 마지막으로 미리보기에 실제 반영된 계산 변수. 입력값과 다르면 표시값 ≠ 생성값이 되므로 가드한다.
  const [appliedOverrides, setAppliedOverrides] = useState<{ lead: string; adjust: string } | null>(
    null
  )
  // 발주 수량 0인 세트까지 펼쳐 볼지 (세트가 수십 종인 상품이 많다)
  const [showZeroSets, setShowZeroSets] = useState(false)

  const defaultDemandAdjust = initialDemandAdjust != null ? String(initialDemandAdjust) : '1'

  const goStep = (i: number) => {
    // 0단계는 상품 선택 화면이다. 상품이 이미 있으면 화면 분기가 없어 검토 화면으로
    // 떨어지므로, 상품 재선택 플로우로 보낸다.
    if (i === STEP_PRODUCT) {
      resetToPicker()
      return
    }
    setStepIdx(i)
    setReached((r) => Math.max(r, i))
  }

  const getPreviewOverrides = () => {
    const leadTimeDays = Number(leadTimeInput)
    const demandAdjustFactor = Number(demandAdjustInput)
    return {
      leadTimeDaysOverride:
        Number.isFinite(leadTimeDays) && leadTimeDays >= 1 ? Math.floor(leadTimeDays) : undefined,
      demandAdjustFactorOverride:
        Number.isFinite(demandAdjustFactor) && demandAdjustFactor > 0
          ? demandAdjustFactor
          : undefined,
    }
  }

  // ── dryRun 미리보기 로드 ────────────────────────────────────────────────────
  const fetchPreview = async (
    productId: string,
    excludeRocket: boolean,
    linkedLocationIds: string[] = [],
    overrides: {
      leadTimeDaysOverride?: number
      demandAdjustFactorOverride?: number
    } = getPreviewOverrides()
  ) => {
    setPreviewLoading(true)
    try {
      const res = await fetch('/api/sh/inventory/reorder/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          dryRun: true,
          excludeRocketLayer: excludeRocket,
          linkedLocationIds,
          ...overrides,
        }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(b.message ?? '미리보기 실패')
      }
      const data = (await res.json()) as Preview
      setPreview(data)
      if (leadTimeInput.trim() === '' && data.options[0]) {
        setLeadTimeInput(String(data.options[0].leadTimeDays))
      }
      // 이번 응답에 실제로 반영된 계산 변수 기록 (override 미지정이면 서버 기본값)
      setAppliedOverrides({
        lead: String(overrides.leadTimeDaysOverride ?? data.options[0]?.leadTimeDays ?? ''),
        adjust: String(overrides.demandAdjustFactorOverride ?? 1),
      })
      const init: Record<string, string> = {}
      for (const o of data.options) init[o.optionId] = String(o.finalQty)
      setFinalByOption(init)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : '미리보기를 불러오지 못했습니다')
      setPreview(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  const loadLinkedLocations = async () => {
    setLocationsLoading(true)
    try {
      const res = await fetch('/api/sh/inventory/locations?isActive=true')
      const data = (await res.json().catch(() => ({}))) as { locations?: LinkedLocation[] }
      if (!res.ok) throw new Error('연동 위치 조회 실패')
      setLinkedLocations((data.locations ?? []).filter((l) => l.externalSource != null))
    } catch (err) {
      console.error(err)
      toast.error('연동 위치 목록을 불러오지 못했습니다')
      setLinkedLocations([])
    } finally {
      setLocationsLoading(false)
    }
  }

  // ── 상품 선택 완료 → 미리보기 로드 → Step ② ─────────────────────────────────
  const handlePickProduct = (
    productId: string,
    opts: Array<{ productName: string; brandName: string | null }>
  ) => {
    const first = opts[0]
    setPicked({
      productId,
      productName: first?.productName ?? '',
      brandName: first?.brandName ?? null,
    })
    setPickerOpen(false)
    setStepIdx(STEP_EXTERNAL)
    setReached(STEP_EXTERNAL)
    setIncludeRocket(true)
    setSelectedLinkedLocationIds([])
    setLeadTimeInput('')
    setDemandAdjustInput(defaultDemandAdjust)
    void loadLinkedLocations()
    void fetchPreview(productId, false, [], {})
  }

  const resetToPicker = () => {
    setPicked(null)
    setPreview(null)
    setFinalByOption({})
    setSelectedLinkedLocationIds([])
    setLeadTimeInput('')
    setDemandAdjustInput(defaultDemandAdjust)
    setStepIdx(STEP_PRODUCT)
    setReached(STEP_PRODUCT)
    setPickerOpen(true)
  }

  // 연동 위치 포함 토글 → 미리보기 재계산(연동 위치 수요 분리 on/off 로 최종수량 달라짐)
  const handleToggleRocket = (checked: boolean) => {
    if (!picked) return
    setIncludeRocket(checked)
    void fetchPreview(picked.productId, !checked, selectedLinkedLocationIds)
  }

  const handleToggleLinkedLocation = (locationId: string, checked: boolean) => {
    if (!picked) return
    const next = checked
      ? Array.from(new Set([...selectedLinkedLocationIds, locationId]))
      : selectedLinkedLocationIds.filter((id) => id !== locationId)
    setSelectedLinkedLocationIds(next)
    setIncludeRocket(true)
    void fetchPreview(picked.productId, false, next)
  }

  const handleSkipLinkedLocation = () => {
    if (!picked) return
    setIncludeRocket(false)
    setSelectedLinkedLocationIds([])
    void fetchPreview(picked.productId, true, [])
  }

  const handleApplyForecastSettings = () => {
    if (!picked) return
    const overrides = getPreviewOverrides()
    if (overrides.leadTimeDaysOverride == null) {
      toast.error('리드타임은 1일 이상으로 입력하세요')
      return
    }
    if (overrides.demandAdjustFactorOverride == null) {
      toast.error('보정계수는 0보다 크게 입력하세요')
      return
    }
    void fetchPreview(picked.productId, !includeRocket, selectedLinkedLocationIds, overrides)
  }

  // 빈값/음수 정리(≥0). baseline 미만도 허용 — 재고가 수요를 덮으면 final < baseline 이 정상.
  const clampFinal = (raw: string): string => {
    const n = Number(raw)
    if (!Number.isFinite(n) || raw.trim() === '') return raw
    return String(Math.max(0, Math.floor(n)))
  }

  // ── 발주 계획 생성 ──────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!picked || !preview) return
    setCreating(true)
    try {
      const optionFinalOverrides: Record<string, number> = {}
      for (const o of preview.options) {
        const raw = finalByOption[o.optionId]
        // 빈값/무효 입력은 미리보기 기본값으로 폴백(빈칸 = 0 지정으로 오인 방지).
        if (raw == null || raw.trim() === '') {
          optionFinalOverrides[o.optionId] = o.finalQty
          continue
        }
        const v = Number(raw)
        optionFinalOverrides[o.optionId] = Number.isFinite(v) && v >= 0 ? Math.floor(v) : o.finalQty
      }
      const forecastOverrides = getPreviewOverrides()
      const res = await fetch('/api/sh/inventory/reorder/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: picked.productId,
          excludeRocketLayer: !includeRocket,
          linkedLocationIds: includeRocket ? selectedLinkedLocationIds : [],
          optionFinalOverrides,
          ...forecastOverrides,
        }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(b.message ?? '생성 실패')
      }
      const data = (await res.json()) as { planId: string }
      toast.success('발주 계획 초안이 생성되었습니다')
      router.push(`/d/seller-ops/inventory/reorder/plans/${data.planId}`)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : '발주 계획 생성에 실패했습니다')
    } finally {
      setCreating(false)
    }
  }

  // ── 파생값 ──────────────────────────────────────────────────────────────────
  const options = useMemo(() => preview?.options ?? [], [preview])
  const isMultiProduct = new Set(options.map((o) => o.productId)).size > 1
  const showBaseline = includeRocket && !!preview?.qualifies

  const finalQtyOf = (o: PreviewOption): number => {
    const raw = finalByOption[o.optionId]
    if (raw == null || raw.trim() === '') return o.finalQty
    const v = Number(raw)
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : o.finalQty
  }

  const totalFinal = options.reduce((s, o) => s + finalQtyOf(o), 0)
  const hasCost = options.some((o) => o.costPrice != null)
  const totalAmount = options.reduce((s, o) => s + finalQtyOf(o) * (o.costPrice ?? 0), 0)
  const totalSetQty = (preview?.sets ?? []).reduce((s, x) => s + x.finalSetQty, 0)
  // 계산 변수를 바꾼 뒤 "계산 다시 적용"을 누르지 않으면 화면 수량과 생성될 수량이 어긋난다.
  // 문자열 비교 금지 — 적용값은 Math.floor 후 저장되므로 '30' vs '30.0'이 영구 dirty가 된다.
  const settingsDirty =
    appliedOverrides != null &&
    (Number(appliedOverrides.lead) !== Math.floor(Number(leadTimeInput)) ||
      Number(appliedOverrides.adjust) !== Number(demandAdjustInput))
  const horizonDays = Number(leadTimeInput) || options[0]?.leadTimeDays || 0

  // 외부 연동 / 자체 출고 소계 — 비연동 계획이면 전체 수요를 자체 출고로 본다.
  const externalBySku = new Map(options.map((o) => [o.optionId, o.rocketBaselineQty ?? 0]))
  const ownBySku = new Map(
    options.map((o) => [o.optionId, o.directGrossQty ?? (showBaseline ? 0 : o.roundedSuggestedQty)])
  )
  const externalTotal = options.reduce((s, o) => s + (externalBySku.get(o.optionId) ?? 0), 0)
  const ownTotal = options.reduce((s, o) => s + (ownBySku.get(o.optionId) ?? 0), 0)

  // ── 공용 블록 ───────────────────────────────────────────────────────────────
  const loadingBlock = (
    <div className="flex items-center justify-center gap-2 rounded-lg border py-12 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      수요·예측 미리보기를 불러오는 중...
    </div>
  )

  const productHeader = picked && (
    <Panel padded={false}>
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="grid h-11 w-11 flex-none place-items-center rounded-md bg-muted text-muted-foreground">
          <PackageIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{picked.productName}</div>
          <div className="text-xs text-muted-foreground">
            {picked.brandName ? `${picked.brandName} · ` : ''}옵션 {options.length}종
            {preview?.sets.length ? ` · 세트 ${preview.sets.length}종` : ''}
            {preview?.locationName ? ` · 연동 위치 ${preview.locationName}` : ''}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-6">
          <Kpi
            label="분석 기간"
            value={options[0]?.analysisWindowDays ?? '—'}
            unit="일"
            size="sm"
          />
          <Kpi label="리드타임" value={horizonDays || '—'} unit="일" size="sm" />
          <Button variant="outline" size="sm" className="gap-1.5" onClick={resetToPicker}>
            <ArrowLeft className="h-3.5 w-3.5" />
            다른 상품 선택
          </Button>
        </div>
      </div>
    </Panel>
  )

  const forecastSettings = (
    <div className="grid gap-3 rounded-md border bg-background px-3 py-3 sm:grid-cols-[160px_160px_auto] sm:items-end">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">리드타임</label>
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min={1}
            max={365}
            inputMode="numeric"
            className="h-8 text-right tabular-nums"
            value={leadTimeInput}
            onChange={(e) => setLeadTimeInput(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">일</span>
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">보정계수</label>
        <Input
          type="number"
          min={0.1}
          max={10}
          step={0.1}
          inputMode="decimal"
          className="h-8 text-right tabular-nums"
          value={demandAdjustInput}
          onChange={(e) => setDemandAdjustInput(e.target.value)}
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleApplyForecastSettings}
        disabled={previewLoading}
      >
        계산 다시 적용
      </Button>
      <p className="text-xs text-muted-foreground sm:col-span-3">
        예측 소진량 = 90일 판매 이력 기반 예측 일평균 × 리드타임 × 보정계수입니다. 보정계수 1.0은
        기본 예측을 그대로 사용합니다.
      </p>
    </div>
  )

  /** 옵션별 소계 표 (비중 막대 + 선택적 비교 컬럼) */
  const subtotalPanel = (
    title: string,
    desc: string,
    bySku: Map<string, number>,
    compare?: { label: string; bySku: Map<string, number> }
  ) => {
    const max = Math.max(1, ...options.map((o) => bySku.get(o.optionId) ?? 0))
    const total = options.reduce((s, o) => s + (bySku.get(o.optionId) ?? 0), 0)
    return (
      <Panel
        title={title}
        desc={desc}
        padded={false}
        right={
          <Kpi label="소계" value={fmtQty(total)} unit="개" size="md" className="text-right" />
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>옵션</TableHead>
              <TableHead className="text-right">수량</TableHead>
              <TableHead className="w-[220px]">비중</TableHead>
              {compare && <TableHead className="text-right">{compare.label}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {options.map((o) => (
              <TableRow key={o.optionId}>
                <TableCell className="text-sm">
                  {isMultiProduct && (
                    <div className="text-[10px] font-medium text-muted-foreground">
                      {o.productName}
                    </div>
                  )}
                  {o.optionName}
                  {o.sku && (
                    <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                      {o.sku}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {fmtQty(bySku.get(o.optionId) ?? 0)}
                </TableCell>
                <TableCell>
                  <Bar value={bySku.get(o.optionId) ?? 0} max={max} />
                </TableCell>
                {compare && (
                  <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                    {fmtQty(compare.bySku.get(o.optionId) ?? 0)}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    )
  }

  const summaryBar = (actions: ReactNode) => (
    <PlanSummaryBar
      stats={[
        { label: '최종 발주 수량', value: fmtQty(totalFinal), unit: '개' },
        ...(preview?.sets.length
          ? [{ label: '세트 환산', value: fmtQty(totalSetQty), unit: '세트' }]
          : []),
        ...(hasCost ? [{ label: '발주 금액', value: fmtWon(totalAmount) }] : []),
        { label: '재고 커버', value: String(horizonDays), unit: '일 기준' },
      ]}
      actions={actions}
    />
  )

  // ── Step ① 상품 선택 ────────────────────────────────────────────────────────
  if (!picked) {
    return (
      <div className="space-y-4">
        <StepBar steps={STEPS} current={STEP_PRODUCT} reached={reached} onGo={goStep} />
        {!pickerOpen && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-muted/20 py-12">
            <p className="text-sm text-muted-foreground">
              상품을 선택하면 외부 연동 확인부터 순차로 계획합니다
            </p>
            <Button variant="outline" className="gap-1.5" onClick={() => setPickerOpen(true)}>
              <PackageIcon className="h-3.5 w-3.5" />
              상품 선택
            </Button>
          </div>
        )}
        <OptionPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          mode="product-with-all-options"
          onPickProduct={handlePickProduct}
          contextLabel="발주 계획"
        />
      </div>
    )
  }

  // ── Step ② 외부 연동 확인 ───────────────────────────────────────────────────
  if (stepIdx === STEP_EXTERNAL) {
    return (
      <div className="space-y-4">
        <StepBar steps={STEPS} current={STEP_EXTERNAL} reached={reached} onGo={goStep} />
        {productHeader}
        {previewLoading || !preview ? (
          loadingBlock
        ) : preview.qualifies ? (
          <TooltipProvider>
            <div className="space-y-4">
              <Panel
                title={
                  <span className="flex items-center gap-2">
                    <MapPinIcon className="h-4 w-4 text-indigo-600" />
                    연동 위치 <span className="text-indigo-700">[{preview.locationName}]</span> 판매
                    감지됨
                  </span>
                }
                desc="로켓그로스 입고 필요 수량을 먼저 계산하고, 다음 단계에서 나머지 수량과 합산합니다."
                right={
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={includeRocket}
                      onCheckedChange={(v) => handleToggleRocket(v === true)}
                    />
                    <span className="font-medium">연동 위치 발주 포함</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-80 leading-relaxed">
                        로켓그로스 같은 연동 위치로 입고해야 하는 수량을 따로 계산해 최종 발주에
                        포함합니다. 끄면 연동 위치 수요를 분리하지 않고 일반 발주 수량만 계산합니다.
                      </TooltipContent>
                    </Tooltip>
                  </label>
                }
              >
                {forecastSettings}
              </Panel>

              {includeRocket && (
                <Panel
                  title="연동 위치 옵션 전개"
                  desc="예측 소진량 · 배분 안전재고 · 위치 재고 기준 부족분"
                  padded={false}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>옵션</TableHead>
                        <TableHead className="text-right">
                          <span className="inline-flex items-center justify-end gap-1">
                            예측 소진량
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <HelpCircle className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-96 leading-relaxed whitespace-pre-line">
                                {`로켓그로스 판매 이력으로 예측한 입고 전 소진량입니다.\n\n= 분석 기간 판매 이력 기반 예측 일평균 × 리드타임 × 보정계수\n\n현재 기본 분석 기간은 90일이고, 상품별 발주 설정의 분석 기간을 따릅니다. 이 값은 90일 판매량 합계가 아니라 리드타임 동안 소진될 것으로 보는 수량입니다.`}
                              </TooltipContent>
                            </Tooltip>
                          </span>
                        </TableHead>
                        <TableHead className="text-right">
                          <span className="inline-flex items-center justify-end gap-1">
                            배분 안전재고
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <HelpCircle className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-96 leading-relaxed whitespace-pre-line">
                                {`옵션 안전재고 중 로켓그로스 판매 비중만큼 배분한 수량입니다.\n\n= 옵션 안전재고 × 로켓그로스 예측 소진량 / 전체 예측 소진량\n\n옵션 안전재고 전체를 로켓그로스에 몰아넣지 않기 위한 값입니다.`}
                              </TooltipContent>
                            </Tooltip>
                          </span>
                        </TableHead>
                        <TableHead className="text-right">현재고</TableHead>
                        <TableHead className="text-right">입고예정</TableHead>
                        <TableHead className="text-right">
                          <span className="inline-flex items-center justify-end gap-1">
                            입고 필요 수량
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <HelpCircle className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-96 leading-relaxed whitespace-pre-line">
                                {`로켓그로스 위치 기준 부족분입니다.\n\n= 예측 소진량 + 배분 안전재고 - 현재고 - 입고예정\n\n이 값은 위치별 필요 수량입니다. 아래 최종 발주의 '연동 위치 입고'는 전체 최종 발주 수량을 초과할 수 없어서 이 값보다 작을 수 있습니다.`}
                              </TooltipContent>
                            </Tooltip>
                          </span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.options.map((o) => (
                        <TableRow key={o.optionId}>
                          <TableCell className="text-sm">{o.optionName}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {fmtQty(o.linkedLocationExpectedSalesQty ?? 0)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {fmtQty(o.linkedLocationSafetyStockQty ?? 0)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                            {fmtQty(o.linkedLocationCurrentStockQty ?? 0)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                            {fmtQty(o.linkedLocationIncomingQty ?? 0)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold tabular-nums">
                            {fmtQty(o.linkedLocationNeedQty ?? 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Panel>
              )}

              {includeRocket &&
                subtotalPanel(
                  `외부 연동 소계 — 옵션 단위 ${fmtQty(externalTotal)}개`,
                  '최종 발주 중 연동 위치로 입고될 분배 수량',
                  externalBySku
                )}
            </div>
          </TooltipProvider>
        ) : (
          <div className="space-y-4">
            <Panel
              title="연동 위치에서 이 상품이 자동 감지되지 않았습니다"
              desc="연동 위치를 직접 선택하면 해당 위치의 매핑/재고에서 옵션을 다시 찾습니다. 없으면 스킵하고 일반 발주로 진행합니다."
            >
              <div className="space-y-3">
                {forecastSettings}
                <div className="space-y-2 rounded-md border bg-background px-3 py-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    연동 위치 직접 선택 {locationsLoading && '· 불러오는 중...'}
                  </p>
                  {linkedLocations.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      선택 가능한 연동 위치가 없습니다.
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {linkedLocations.map((loc) => (
                        <label
                          key={loc.id}
                          className="flex items-center gap-2 rounded-md border px-3 py-2"
                        >
                          <Checkbox
                            checked={selectedLinkedLocationIds.includes(loc.id)}
                            onCheckedChange={(v) => handleToggleLinkedLocation(loc.id, v === true)}
                          />
                          <span className="text-sm">{loc.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={handleSkipLinkedLocation}>
                    연동 위치 단계 스킵
                  </Button>
                </div>
              </div>
            </Panel>
          </div>
        )}

        {summaryBar(
          <StepNav
            onNext={() => goStep(STEP_OWN)}
            nextLabel="다음 · 자체 출고 확인"
            nextDisabled={previewLoading || !preview}
          />
        )}
      </div>
    )
  }

  // ── Step ③ 자체 출고 확인 ───────────────────────────────────────────────────
  if (stepIdx === STEP_OWN) {
    return (
      <div className="space-y-4">
        <StepBar steps={STEPS} current={STEP_OWN} reached={reached} onGo={goStep} />
        {productHeader}
        {previewLoading || !preview ? (
          loadingBlock
        ) : (
          <div className="space-y-4">
            <Panel
              title="자체 출고 물량은 우리 창고에서 나가는 수량입니다"
              desc={
                showBaseline
                  ? `외부 연동 소계 ${fmtQty(externalTotal)}개에 이 물량을 더해 최종 발주 수량을 만듭니다.`
                  : '연동 위치 분리 없이 전체 판매 수요를 자체 출고로 계산합니다.'
              }
            >
              <div className="flex flex-wrap items-center gap-8">
                <Kpi
                  label="외부 연동"
                  value={fmtQty(externalTotal)}
                  unit="개"
                  size="lg"
                  valueClassName={showBaseline ? undefined : 'text-muted-foreground'}
                />
                <Kpi label="자체 출고" value={fmtQty(ownTotal)} unit="개" size="lg" />
                <Kpi
                  label="합계"
                  value={fmtQty(externalTotal + ownTotal)}
                  unit="개"
                  size="lg"
                  sub="위치별 입고 분배 합"
                />
              </div>
            </Panel>
            {subtotalPanel(
              `자체 출고 소계 — 옵션 단위 ${fmtQty(ownTotal)}개`,
              '연동 위치를 제외한 나머지 위치 입고 수량',
              ownBySku,
              showBaseline ? { label: '외부 연동', bySku: externalBySku } : undefined
            )}
          </div>
        )}

        {summaryBar(
          <StepNav
            onPrev={() => goStep(STEP_EXTERNAL)}
            onNext={() => goStep(STEP_CALC)}
            nextLabel="다음 · 수량 계산"
            nextDisabled={previewLoading || !preview}
          />
        )}
      </div>
    )
  }

  // ── Step ④ 수량 계산 ────────────────────────────────────────────────────────
  if (stepIdx === STEP_CALC) {
    const adjustFactor = Number(demandAdjustInput)
    const adjustPct = Number.isFinite(adjustFactor) ? Math.round((adjustFactor - 1) * 100) : 0
    return (
      <div className="space-y-4">
        <StepBar steps={STEPS} current={STEP_CALC} reached={reached} onGo={goStep} />
        {productHeader}

        <div className="grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <Panel title="계산 변수" desc="적용하면 우측 표가 다시 계산됩니다" padded={false}>
            <div className="space-y-4 px-5 pt-4 pb-5">
              <div className="space-y-1.5 border-b pb-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">리드타임</span>
                  <span className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      inputMode="numeric"
                      className="h-8 w-20 text-right font-mono tabular-nums"
                      value={leadTimeInput}
                      onChange={(e) => setLeadTimeInput(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">일</span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">발주 → 입고까지 걸리는 일수</p>
              </div>

              <div className="space-y-2 border-b pb-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">판매 증감 보정</span>
                  <span className="w-14 text-right font-mono text-sm tabular-nums">
                    ×{Number.isFinite(adjustFactor) ? adjustFactor.toFixed(2) : '—'}
                  </span>
                </div>
                <Slider
                  min={-50}
                  max={100}
                  step={1}
                  value={[adjustPct]}
                  onValueChange={([v]) => setDemandAdjustInput(String(1 + (v ?? 0) / 100))}
                />
                <p className="text-xs text-muted-foreground">
                  향후 판매를 {adjustPct >= 0 ? '+' : ''}
                  {adjustPct}% 로 가정 (자동 bias 보정 위에 곱해집니다)
                </p>
              </div>

              <Button
                type="button"
                size="sm"
                className="w-full"
                variant={settingsDirty ? 'default' : 'outline'}
                onClick={handleApplyForecastSettings}
                disabled={previewLoading}
              >
                계산 다시 적용
              </Button>
              {settingsDirty && (
                <p className="text-xs text-amber-700">
                  변경한 계산 변수가 아직 반영되지 않았습니다. 적용해야 아래 수량과 생성될 계획이
                  일치합니다.
                </p>
              )}

              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">계산식</div>
                <div className="rounded-md bg-muted px-3 py-2.5 font-mono text-[11px] leading-relaxed">
                  예측 일평균 × 보정 × {horizonDays || '리드타임'}일
                  <br />+ 안전재고 − 현재고 − 입고예정
                  <br />→ 발주 단위 반올림
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            title="옵션별 최종 발주 수량"
            desc="옵션(SKU) 단위 — 실제 발주에 들어가는 숫자"
            padded={false}
            right={
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-semibold tabular-nums">
                  {fmtQty(totalFinal)}
                </span>
                <span className="text-xs text-muted-foreground">
                  개{hasCost ? ` · ${fmtWon(totalAmount)}` : ''}
                </span>
              </div>
            }
          >
            {previewLoading || !preview ? (
              loadingBlock
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>옵션</TableHead>
                    {showBaseline && <TableHead className="text-right">외부 연동</TableHead>}
                    {showBaseline && <TableHead className="text-right">자체 출고</TableHead>}
                    <TableHead className="text-right">예측 일평균</TableHead>
                    <TableHead className="text-right">현재고 / 입고예정</TableHead>
                    <TableHead className="text-right">안전재고</TableHead>
                    <TableHead className="text-right">최종수량</TableHead>
                    <TableHead className="w-24 text-right">커버</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {options.map((o) => {
                    const finalQty = finalQtyOf(o)
                    // 표시용 파생값 — 서버 계산이 아니라 "이 수량이면 며칠 버티는가"의 환산.
                    const coverDays =
                      o.dailyAvgForecast > 0 ? (o.currentStock + finalQty) / o.dailyAvgForecast : 0
                    const roundDelta = o.roundedSuggestedQty - o.suggestedQty
                    return (
                      <TableRow key={o.optionId}>
                        <TableCell className="text-sm">
                          {isMultiProduct && (
                            <div className="text-[10px] font-medium text-muted-foreground">
                              {o.productName}
                            </div>
                          )}
                          <span>{o.optionName}</span>
                          {o.sku && (
                            <div className="font-mono text-[11px] text-muted-foreground">
                              {o.sku}
                            </div>
                          )}
                        </TableCell>
                        {showBaseline && (
                          <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                            {fmtQty(o.rocketBaselineQty ?? 0)}
                          </TableCell>
                        )}
                        {showBaseline && (
                          <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                            {fmtQty(o.directGrossQty ?? 0)}
                          </TableCell>
                        )}
                        <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                          {o.dailyAvgForecast.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                          {fmtQty(o.onHandStock)}
                          {o.incomingQty > 0 ? ` / +${fmtQty(o.incomingQty)}` : ' / —'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                          {fmtQty(o.safetyStockQty)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            className="ml-auto h-8 w-24 text-right font-mono font-semibold tabular-nums"
                            value={finalByOption[o.optionId] ?? ''}
                            onChange={(e) =>
                              setFinalByOption((prev) => ({
                                ...prev,
                                [o.optionId]: e.target.value,
                              }))
                            }
                            onBlur={(e) =>
                              setFinalByOption((prev) => ({
                                ...prev,
                                [o.optionId]: clampFinal(e.target.value),
                              }))
                            }
                          />
                          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                            제안 {fmtQty(o.roundedSuggestedQty)}
                            {roundDelta > 0.5 ? ` (라운딩 +${fmtQty(roundDelta)})` : ''}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-mono text-sm tabular-nums">
                            {coverDays > 900 || coverDays === 0
                              ? '—'
                              : `${Math.round(coverDays)}일`}
                          </div>
                          <Bar
                            className="mt-1"
                            value={Math.min(coverDays, 90)}
                            max={90}
                            tone={
                              coverDays > 0 && coverDays < horizonDays
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </Panel>
        </div>

        {showBaseline && (
          <p className="text-[11px] text-muted-foreground">
            · 입고 시 외부 연동 수량은 로켓그로스로, 자체 출고 수량은 일반 위치 입고로 분리됩니다.
            최종수량은 두 수량을 합산한 뒤 발주 단위로 반올림한 값입니다.
          </p>
        )}

        {summaryBar(
          <StepNav
            onPrev={() => goStep(STEP_OWN)}
            onNext={() => goStep(STEP_REVIEW)}
            nextLabel="다음 · 세트 환산 · 검토"
            nextDisabled={previewLoading || !preview || options.length === 0 || settingsDirty}
          />
        )}
      </div>
    )
  }

  // ── Step ⑤ 세트 환산 · 검토 ─────────────────────────────────────────────────
  const sets = preview?.sets ?? []
  const optionNameById = new Map(options.map((o) => [o.optionId, o.optionName]))
  // 세트가 수십 종인 상품이 흔하다. 발주 수량 0인 세트는 기본으로 접는다.
  const activeSets = sets.filter((s) => s.finalSetQty > 0)
  const zeroSets = sets.filter((s) => s.finalSetQty <= 0)
  const visibleSets = showZeroSets ? sets : activeSets
  return (
    <div className="space-y-4">
      <StepBar steps={STEPS} current={STEP_REVIEW} reached={reached} onGo={goStep} />
      {productHeader}

      {previewLoading || !preview ? (
        loadingBlock
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            {sets.length > 0 && (
              <>
                <Panel
                  title="입고되면 이 구성대로 세트를 묶어 연동 위치에 등록합니다"
                  desc={`발주 ${fmtQty(totalFinal)}개 → 세트 ${fmtQty(totalSetQty)}개 환산 · 발주 대상 ${activeSets.length}종 / 전체 ${sets.length}종`}
                  right={
                    zeroSets.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setShowZeroSets((v) => !v)}
                      >
                        {showZeroSets ? '0세트 접기' : `0세트 ${zeroSets.length}종 보기`}
                      </Button>
                    )
                  }
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    {visibleSets.map((s) => (
                      <div key={s.listingId} className="rounded-md border">
                        <div className="flex items-end justify-between gap-3 border-b px-4 py-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{s.listingName}</div>
                            <div className="text-xs text-muted-foreground">
                              현재 세트재고 {fmtQty(s.currentSetStock)}세트
                            </div>
                          </div>
                          <div className="flex flex-none items-baseline gap-1 whitespace-nowrap">
                            <span className="font-mono text-xl font-semibold tabular-nums">
                              {fmtQty(s.finalSetQty)}
                            </span>
                            <span className="text-xs text-muted-foreground">세트</span>
                          </div>
                        </div>
                        <div className="px-4 py-3">
                          <div className="mb-2 text-xs text-muted-foreground">
                            구성 (세트 1개 기준)
                          </div>
                          <table className="w-full">
                            <tbody>
                              {s.items.map((it) => (
                                <tr key={it.optionId}>
                                  <td className="py-1 text-sm">
                                    {optionNameById.get(it.optionId) ?? it.optionId}
                                  </td>
                                  <td className="w-14 py-1 text-right font-mono text-sm text-muted-foreground tabular-nums">
                                    ×{it.perSet}
                                  </td>
                                  <td className="w-20 py-1 text-right font-mono text-sm tabular-nums">
                                    {fmtQty(s.finalSetQty * it.perSet)}개
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              </>
            )}

            <Panel
              title="발주 내역 — 옵션 단위"
              desc={`발주 ${options.filter((o) => finalQtyOf(o) > 0).length}종`}
              padded={false}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>옵션</TableHead>
                    <TableHead className="text-right">수량</TableHead>
                    {hasCost && <TableHead className="text-right">단가</TableHead>}
                    {hasCost && <TableHead className="text-right">금액</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {options
                    .filter((o) => finalQtyOf(o) > 0)
                    .map((o) => (
                      <TableRow key={o.optionId}>
                        <TableCell className="text-sm">
                          {o.optionName}
                          {o.sku && (
                            <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                              {o.sku}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {fmtQty(finalQtyOf(o))}
                        </TableCell>
                        {hasCost && (
                          <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                            {o.costPrice != null ? fmtWon(o.costPrice) : '—'}
                          </TableCell>
                        )}
                        {hasCost && (
                          <TableCell className="text-right font-mono tabular-nums">
                            {o.costPrice != null ? fmtWon(finalQtyOf(o) * o.costPrice) : '—'}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              {options.some((o) => finalQtyOf(o) === 0) && (
                <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
                  <span>발주 제외</span>
                  {options
                    .filter((o) => finalQtyOf(o) === 0)
                    .map((o) => (
                      <span
                        key={o.optionId}
                        className="inline-flex gap-1.5 rounded-full border px-2 py-0.5"
                      >
                        {o.optionName}
                        <b className="font-mono">재고 {fmtQty(o.currentStock)}개</b>
                      </span>
                    ))}
                  <span>— 커버 기간 내 재고로 충당됩니다</span>
                </div>
              )}
            </Panel>
          </div>

          <Panel title="검토 요약">
            <div className="space-y-4">
              <Kpi
                label="최종 발주 수량"
                value={fmtQty(totalFinal)}
                unit="개"
                size="lg"
                sub={`옵션 ${options.filter((o) => finalQtyOf(o) > 0).length}종`}
              />
              {sets.length > 0 && (
                <Kpi label="세트 환산" value={fmtQty(totalSetQty)} unit="세트" size="lg" />
              )}
              {hasCost && <Kpi label="발주 금액" value={fmtWon(totalAmount)} size="lg" />}
              <div className="space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>리드타임</span>
                  <span className="font-mono tabular-nums">{horizonDays}일</span>
                </div>
                <div className="flex justify-between">
                  <span>보정계수</span>
                  <span className="font-mono tabular-nums">×{demandAdjustInput}</span>
                </div>
                <div className="flex justify-between">
                  <span>연동 위치 발주</span>
                  <span>{showBaseline ? '포함' : '미포함'}</span>
                </div>
              </div>
              {settingsDirty && (
                <p className="text-xs text-amber-700">
                  계산 변수가 미반영 상태입니다. &lsquo;수량 계산&rsquo; 단계에서 다시 적용하세요.
                </p>
              )}
              <Button
                className="w-full gap-1.5"
                disabled={
                  creating || previewLoading || !preview || options.length === 0 || settingsDirty
                }
                onClick={handleCreate}
              >
                <PlusIcon className="h-3.5 w-3.5" />
                {creating ? '생성 중...' : '발주 계획 생성'}
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {summaryBar(<StepNav onPrev={() => goStep(STEP_CALC)} />)}
    </div>
  )
}
