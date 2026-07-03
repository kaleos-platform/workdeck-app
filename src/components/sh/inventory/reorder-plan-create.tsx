'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ArrowRight,
  CheckIcon,
  Loader2,
  MapPinIcon,
  PackageIcon,
  PlusIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { OptionPickerDialog } from '@/components/sh/products/listings/option-picker-dialog'

// dryRun 미리보기(POST /reorder/plan { dryRun:true }) 응답 — 생성과 동일 코드 경로라 drift 없음.
type PreviewOption = {
  optionId: string
  productId: string
  optionName: string
  sku: string | null
  productName: string
  currentStock: number
  safetyStockQty: number
  dailyAvgForecast: number
  leadTimeDays: number
  roundedSuggestedQty: number
  rocketBaselineQty: number | null // 레이어드 옵션별 로켓 baseline(floor). 비레이어드 = null.
  finalQty: number // 기본 최종수량 = baseline + 추가
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
// 상품 선택 후 순차 단계. 'rocket' = 연동 위치 발주 확인, 'options' = 옵션별 최종 발주.
type Step = 'rocket' | 'options'

const QTY = new Intl.NumberFormat('ko-KR')

type Props = {
  /** 생성 모드 진입 시 상품 선택 팝업을 자동으로 연다 */
  autoOpen?: boolean
  /** (호환) 부모의 "계획 목록으로" 버튼 사용 — 여기선 호출하지 않음 */
  onCancel?: () => void
}

/**
 * 발주 계획 생성 — 상품 우선 순차 위저드 (Funnel 3-step).
 *
 * ① 상품 선택 (OptionPickerDialog)
 * ② 연동 위치 발주 확인 — 자동 감지된 로켓 세트 baseline 표시(읽기전용) + 포함 여부 체크
 * ③ 옵션별 최종 발주 — 최종 = baseline + 추가(전체 판매 근거), 옵션별 편집(floor: 최종 ≥ baseline)
 *    → POST 생성 → 상세. 생산 등록은 상세의 "생산차수 생성"(기존).
 *
 * 미리보기는 POST { dryRun:true } 로 생성과 동일 계산을 받아 표시값=생성값 정합.
 */
export function ReorderPlanCreate({ autoOpen = true }: Props) {
  const router = useRouter()
  const [pickerOpen, setPickerOpen] = useState(autoOpen)
  const [picked, setPicked] = useState<PickedProduct | null>(null)
  const [step, setStep] = useState<Step>('rocket')

  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [includeRocket, setIncludeRocket] = useState(true)
  // 옵션별 편집 최종수량(문자열 — 입력 중 빈값 허용). 미리보기 로드 시 finalQty 로 초기화.
  const [finalByOption, setFinalByOption] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)

  // ── dryRun 미리보기 로드 ────────────────────────────────────────────────────
  const fetchPreview = async (productId: string, excludeRocket: boolean) => {
    setPreviewLoading(true)
    try {
      const res = await fetch('/api/sh/inventory/reorder/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, dryRun: true, excludeRocketLayer: excludeRocket }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(b.message ?? '미리보기 실패')
      }
      const data = (await res.json()) as Preview
      setPreview(data)
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
    setStep('rocket')
    setIncludeRocket(true)
    void fetchPreview(productId, false)
  }

  const resetToPicker = () => {
    setPicked(null)
    setPreview(null)
    setFinalByOption({})
    setStep('rocket')
    setPickerOpen(true)
  }

  // 연동 위치 포함 토글 → 미리보기 재계산(레이어드 on/off 로 최종수량 달라짐)
  const handleToggleRocket = (checked: boolean) => {
    if (!picked) return
    setIncludeRocket(checked)
    void fetchPreview(picked.productId, !checked)
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
      const res = await fetch('/api/sh/inventory/reorder/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: picked.productId,
          excludeRocketLayer: !includeRocket,
          optionFinalOverrides,
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

  // ── 스텝 인디케이터 ─────────────────────────────────────────────────────────
  const currentStepNo = !picked ? 1 : step === 'rocket' ? 2 : 3
  const stepIndicator = (
    <ol className="flex items-center gap-2 text-sm">
      {[
        { no: 1, label: '상품 선택' },
        { no: 2, label: '연동 위치 발주' },
        { no: 3, label: '옵션별 발주' },
      ].map((s, i) => {
        const active = s.no === currentStepNo
        const done = s.no < currentStepNo
        return (
          <li key={s.no} className="flex items-center gap-2">
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : done
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {done ? <CheckIcon className="h-3.5 w-3.5" /> : s.no}
            </span>
            <span className={active ? 'font-medium' : 'text-muted-foreground'}>{s.label}</span>
            {i < 2 && <span className="mx-1 h-px w-6 bg-border" />}
          </li>
        )
      })}
    </ol>
  )

  // ── Step ① 상품 미선택 ──────────────────────────────────────────────────────
  if (!picked) {
    return (
      <div className="space-y-4">
        {stepIndicator}
        {!pickerOpen && (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed bg-muted/20 py-10">
            <p className="text-sm text-muted-foreground">
              상품을 선택하면 연동 위치 발주부터 순차로 계획합니다
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

  const productHeader = (
    <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-base font-semibold">{picked.productName}</div>
        {picked.brandName && <div className="text-xs text-muted-foreground">{picked.brandName}</div>}
      </div>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={resetToPicker}>
        <ArrowLeft className="h-3.5 w-3.5" />
        다른 상품 선택
      </Button>
    </div>
  )

  const loadingBlock = (
    <div className="flex items-center justify-center gap-2 rounded-md border py-12 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      수요·예측 미리보기를 불러오는 중...
    </div>
  )

  // ── Step ② 연동 위치 발주 확인 ──────────────────────────────────────────────
  if (step === 'rocket') {
    return (
      <div className="space-y-4">
        {stepIndicator}
        {productHeader}
        {previewLoading || !preview ? (
          loadingBlock
        ) : preview.qualifies ? (
          <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/40 px-4 py-4">
            <div className="flex items-start gap-2">
              <MapPinIcon className="mt-0.5 h-4 w-4 text-indigo-600" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  연동 위치 <span className="text-indigo-700">[{preview.locationName}]</span> 에서
                  세트 {preview.sets.length}개로 판매됩니다
                </p>
                <p className="text-xs text-muted-foreground">
                  연동 위치 세트 수요를 옵션별 1차 발주 수량(baseline)으로 잡습니다. 다음 단계에서
                  전체 판매량 근거로 추가 발주를 계획합니다.
                </p>
              </div>
            </div>

            <label className="flex w-fit items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
              <Checkbox
                checked={includeRocket}
                onCheckedChange={(v) => handleToggleRocket(v === true)}
              />
              연동 위치 발주 포함 (레이어드)
            </label>

            {includeRocket && (
              <div className="overflow-x-auto rounded-md border bg-background">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>옵션</TableHead>
                      <TableHead className="text-right">1차 발주 수량 (baseline)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.options.map((o) => (
                      <TableRow key={o.optionId}>
                        <TableCell className="text-sm">{o.optionName}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {QTY.format(o.rocketBaselineQty ?? 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-md border bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
            연동 위치 세트 판매가 감지되지 않았습니다 → 일반 발주로 진행합니다.
          </div>
        )}

        <div className="flex justify-end">
          <Button
            className="gap-1.5"
            disabled={previewLoading || !preview}
            onClick={() => setStep('options')}
          >
            옵션별 발주
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    )
  }

  // ── Step ③ 옵션별 최종 발주 ─────────────────────────────────────────────────
  const options = preview?.options ?? []
  const isMultiProduct = new Set(options.map((o) => o.productId)).size > 1
  const showBaseline = includeRocket && !!preview?.qualifies
  const totalFinal = options.reduce((s, o) => {
    const v = Number(finalByOption[o.optionId])
    return s + (Number.isFinite(v) ? v : 0)
  }, 0)

  return (
    <div className="space-y-4">
      {stepIndicator}
      {productHeader}

      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          최종 발주{' '}
          <span className="text-xs font-normal text-muted-foreground">
            {showBaseline
              ? '· 연동 위치 baseline(참고) + 전체 판매량 근거 최종 발주 (옵션별 편집)'
              : '· 전체 판매량 기반 옵션별 발주 수량 (옵션별 편집)'}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          최종 합계 <span className="font-medium tabular-nums">{QTY.format(totalFinal)}</span>개
        </p>
      </div>

      {previewLoading || !preview ? (
        loadingBlock
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>옵션</TableHead>
                {showBaseline && <TableHead className="text-right">연동 위치 baseline</TableHead>}
                <TableHead className="text-right">전체 판매 일평균</TableHead>
                <TableHead className="text-right">재고</TableHead>
                <TableHead className="text-right">안전재고</TableHead>
                <TableHead className="text-right">최종수량</TableHead>
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
                    <span>{o.optionName}</span>
                  </TableCell>
                  {showBaseline && (
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {QTY.format(o.rocketBaselineQty ?? 0)}
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {o.dailyAvgForecast.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {QTY.format(o.currentStock)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {QTY.format(o.safetyStockQty)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className="ml-auto h-8 w-24 text-right tabular-nums"
                      value={finalByOption[o.optionId] ?? ''}
                      onChange={(e) =>
                        setFinalByOption((prev) => ({ ...prev, [o.optionId]: e.target.value }))
                      }
                      onBlur={(e) =>
                        setFinalByOption((prev) => ({
                          ...prev,
                          [o.optionId]: clampFinal(e.target.value),
                        }))
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {showBaseline && (
        <p className="text-[11px] text-muted-foreground">
          · 입고 시 baseline 분(min(최종, baseline))은 세트(묶음 상품)로 연동 위치에, 추가분(최종 −
          baseline)은 위치 지정 입고로 처리됩니다. (재고가 수요를 덮으면 최종이 baseline보다 작을 수
          있습니다.)
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" className="gap-1.5" onClick={() => setStep('rocket')}>
          <ArrowLeft className="h-3.5 w-3.5" />
          연동 위치
        </Button>
        <Button
          className="gap-1.5"
          disabled={creating || previewLoading || !preview || options.length === 0}
          onClick={handleCreate}
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {creating ? '생성 중...' : '발주 계획 생성'}
        </Button>
      </div>
    </div>
  )
}
