'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckIcon, PackageIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ReorderPlanRationalePopover } from './reorder-plan-rationale-popover'
import type {
  ForecastModel,
  PlanDetailResponse,
  ReorderPlan,
  ReorderPlanItem,
  ProductInfo,
} from './reorder-plan-types'

// 시즌 계수 선택지 — 서버 AnswerSchema의 seasonFactor(0.1~5)와 정합. 패널·셀 공용.
const SEASON_FACTOR_OPTIONS = [
  { value: '0.5', label: '비수기 (×0.5)' },
  { value: '1', label: '평상시 (×1.0)' },
  { value: '1.5', label: '성수기 (×1.5)' },
  { value: '2', label: '강한 성수기 (×2.0)' },
]

// 모델 뱃지 색상
const MODEL_BADGE: Record<ForecastModel, string> = {
  SMA: 'border-blue-200 bg-blue-50 text-blue-700',
  WMA: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  HW: 'border-violet-200 bg-violet-50 text-violet-700',
  CROSTON: 'border-orange-200 bg-orange-50 text-orange-700',
  BAYES: 'border-purple-200 bg-purple-50 text-purple-700',
  MANUAL: 'border-gray-200 bg-gray-50 text-gray-700',
}

const MODEL_LABEL: Record<ForecastModel, string> = {
  SMA: 'SMA',
  WMA: 'WMA',
  HW: 'H-W',
  CROSTON: 'Croston',
  BAYES: 'Bayes',
  MANUAL: '수동',
}

// 콜드스타트(데이터 부족) 판별 — 서버 cold-start API와 동일하게 forecastModel === 'BAYES'
function isColdStart(item: ReorderPlanItem) {
  return item.forecastModel === 'BAYES'
}

function ModelBadge({ model }: { model: ForecastModel }) {
  return (
    <Badge variant="outline" className={`text-[10px] ${MODEL_BADGE[model]}`}>
      {MODEL_LABEL[model]}
    </Badge>
  )
}

function StatusBadge({ status }: { status: ReorderPlan['status'] }) {
  if (status === 'DRAFT') {
    return (
      <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700">
        초안
      </Badge>
    )
  }
  if (status === 'FINALIZED') {
    return (
      <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
        확정
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-gray-300 bg-gray-50 text-gray-600">
      소진
    </Badge>
  )
}

// 옵션 정보 빠른 조회용 맵 빌드 (상품 단위 계획이므로 옵션 맵만 필요)
function buildOptionMap(productInfo: ProductInfo[]) {
  const optionMap = new Map<
    string,
    { optionName: string; sku: string | null; optionDeleted?: boolean }
  >()
  for (const p of productInfo) {
    for (const o of p.options) {
      optionMap.set(o.optionId, {
        optionName: o.optionName,
        sku: o.sku,
        optionDeleted: o.optionDeleted,
      })
    }
  }
  return optionMap
}

// debounce hook
function useDebounce<T>(value: T, delay = 600): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// 인라인 최종수량 편집 셀
function FinalQtyCell({
  item,
  readonly,
  onSaved,
}: {
  item: ReorderPlanItem
  readonly: boolean
  onSaved: (itemId: string, finalQty: number) => void
}) {
  const [value, setValue] = useState(String(item.finalQty))
  const debouncedValue = useDebounce(value)
  const initialMount = useRef(true)

  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false
      return
    }
    const n = Number(debouncedValue)
    if (!Number.isFinite(n) || n < 0) return
    if (n === item.finalQty) return
    onSaved(item.id, n)
  }, [debouncedValue]) // eslint-disable-line react-hooks/exhaustive-deps

  if (readonly) {
    return <span className="tabular-nums">{item.finalQty}</span>
  }

  return (
    <Input
      type="number"
      min={0}
      className="h-7 w-20 text-right tabular-nums"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  )
}

/**
 * 콜드스타트(BAYES) 행 전용 "예측 일판매" 셀.
 * 예측 숫자를 주 콘텐츠로 표시하고, 보정 버튼으로 다이얼로그를 열어 개별 조정(보조 경로).
 * 전체 일괄은 헤더 패널이 주. 입력 초기값은 설정값(inputsSnapshot.coldStartInterview)에서
 * 읽음 — dailyAvgForecast(출력) 아님.
 */
function ColdStartCell({
  item,
  readonly,
  onApply,
}: {
  item: ReorderPlanItem
  readonly: boolean
  onApply: (optionId: string, targetDailySales: number, seasonFactor: number) => Promise<void>
}) {
  const saved = item.inputsSnapshot?.coldStartInterview
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(saved ? String(saved.targetDailySales) : '')
  const [season, setSeason] = useState(saved ? String(saved.seasonFactor) : '1')
  const [busy, setBusy] = useState(false)

  // 예측 숫자는 항상 주 콘텐츠로 표시
  const forecast = <span className="tabular-nums">{item.dailyAvgForecast.toFixed(2)}</span>

  if (readonly) {
    return forecast
  }

  const handleApply = async () => {
    const n = Number(target)
    if (!Number.isFinite(n) || n < 0) {
      toast.error('목표 일판매량을 0 이상의 숫자로 입력하세요')
      return
    }
    setBusy(true)
    try {
      await onApply(item.optionId, n, Number(season || '1'))
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {forecast}
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-[11px] text-amber-700 hover:bg-amber-50 hover:text-amber-800"
        onClick={() => setOpen(true)}
        aria-label="콜드스타트 보정"
      >
        <PencilIcon className="mr-0.5 h-3 w-3" />
        보정
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>콜드스타트 보정</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            목표 일판매량과 시즌 계수로 초기 예측을 보정합니다. 현재 예측{' '}
            <span className="font-medium tabular-nums">{item.dailyAvgForecast.toFixed(2)}</span>
            개/일.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground">
                목표 일판매량 (개/일)
              </label>
              <Input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                placeholder="목표 일판매량"
                className="h-8 w-32 text-sm"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground">시즌 계수</label>
              <Select value={season} onValueChange={setSeason}>
                <SelectTrigger className="h-8 w-32 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEASON_FACTOR_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              취소
            </Button>
            <Button onClick={handleApply} disabled={busy || target.trim() === ''}>
              {busy ? '적용 중...' : '적용'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// 인라인 메모 편집 셀 (팝오버 형태)
function UserNoteCell({
  item,
  readonly,
  onSaved,
}: {
  item: ReorderPlanItem
  readonly: boolean
  onSaved: (itemId: string, userNote: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(item.userNote ?? '')

  const handleSave = () => {
    onSaved(item.id, value)
    setOpen(false)
  }

  if (readonly) {
    return (
      <span className="max-w-[120px] truncate text-xs text-muted-foreground">
        {item.userNote || '-'}
      </span>
    )
  }

  return (
    <>
      <button
        className="max-w-[120px] truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
        onClick={() => setOpen(true)}
        type="button"
      >
        {item.userNote || '메모 추가'}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>메모 편집</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={4}
            className="resize-none text-sm"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="발주 이유, 특이사항 등"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button onClick={handleSave}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

type Props = {
  planId: string
  initialData?: PlanDetailResponse
}

export function ReorderPlanDetail({ planId, initialData }: Props) {
  const router = useRouter()
  const [plan, setPlan] = useState<ReorderPlan | null>(initialData?.plan ?? null)
  const [items, setItems] = useState<ReorderPlanItem[]>(initialData?.items ?? [])
  const [productInfo, setProductInfo] = useState<ProductInfo[]>(initialData?.productInfo ?? [])
  const [loading, setLoading] = useState(!initialData)
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // 콜드스타트 전체 적용 패널 입력값
  const [panelTarget, setPanelTarget] = useState('')
  const [panelSeason, setPanelSeason] = useState('1')
  const [panelBusy, setPanelBusy] = useState(false)

  const fetchPlan = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/inventory/reorder/plan/${planId}`)
      if (!res.ok) throw new Error('불러오기 실패')
      const data = (await res.json()) as PlanDetailResponse
      setPlan(data.plan)
      setItems(data.items)
      setProductInfo(data.productInfo)
    } catch (err) {
      console.error(err)
      toast.error('발주 계획을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [planId])

  useEffect(() => {
    if (!initialData) {
      fetchPlan()
    }
  }, [initialData, fetchPlan])

  const optionMap = useMemo(() => buildOptionMap(productInfo), [productInfo])
  const brandName = productInfo[0]?.brandName ?? null

  const readonly = plan?.status !== 'DRAFT'

  // 콜드스타트(데이터 부족) 옵션 수
  const coldStartCount = useMemo(() => items.filter(isColdStart).length, [items])

  const handlePatchItem = useCallback(
    async (itemId: string, body: { finalQty?: number; userNote?: string }) => {
      try {
        const res = await fetch(`/api/sh/inventory/reorder/plan/${planId}/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error('저장 실패')
        setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...body } : it)))
      } catch (err) {
        console.error(err)
        toast.error('수정 사항을 저장하지 못했습니다')
      }
    },
    [planId]
  )

  const handleFinalQtySaved = useCallback(
    (itemId: string, finalQty: number) => handlePatchItem(itemId, { finalQty }),
    [handlePatchItem]
  )

  const handleNoteSaved = useCallback(
    (itemId: string, userNote: string) => handlePatchItem(itemId, { userNote }),
    [handlePatchItem]
  )

  // ── 콜드스타트 적용 공통 — answers 배열을 cold-start API로 전송 후 전체 재조회 ──
  // (패널=전체 콜드스타트, 셀=단건 — 둘 다 서버 스냅샷이 단일 진실원)
  const applyColdStart = useCallback(
    async (answers: { optionId: string; targetDailySales: number; seasonFactor: number }[]) => {
      const res = await fetch(`/api/sh/inventory/reorder/plan/${planId}/cold-start-interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      if (!res.ok) throw new Error('저장 실패')
      await fetchPlan() // 서버가 suggestedQty/finalQty/dailyAvgForecast 재계산하므로 재조회 필수
    },
    [planId, fetchPlan]
  )

  // 패널 — 전체 콜드스타트 옵션에 동일값 일괄 적용 (개별 조정분 포함 덮어쓰기)
  const handlePanelApply = async () => {
    const target = Number(panelTarget)
    if (!Number.isFinite(target) || target < 0) {
      toast.error('목표 일판매량을 0 이상의 숫자로 입력하세요')
      return
    }
    const coldItems = items.filter(isColdStart)
    if (coldItems.length === 0) return
    const factor = Number(panelSeason || '1')
    const answers = coldItems.map((it) => ({
      optionId: it.optionId,
      targetDailySales: target,
      seasonFactor: factor,
    }))
    setPanelBusy(true)
    try {
      await applyColdStart(answers)
      toast.success(`콜드스타트 ${answers.length}개 옵션에 적용했습니다`)
      setPanelTarget('')
    } catch (err) {
      console.error(err)
      toast.error('콜드스타트 일괄 적용에 실패했습니다')
    } finally {
      setPanelBusy(false)
    }
  }

  // 셀 — 특정 콜드스타트 행만 개별 적용
  const handleCellApply = useCallback(
    async (optionId: string, targetDailySales: number, seasonFactor: number) => {
      try {
        await applyColdStart([{ optionId, targetDailySales, seasonFactor }])
        toast.success('콜드스타트 보정을 적용했습니다')
      } catch (err) {
        console.error(err)
        toast.error('콜드스타트 적용에 실패했습니다')
      }
    },
    [applyColdStart]
  )

  const handleFinalize = async () => {
    setFinalizing(true)
    try {
      const res = await fetch(`/api/sh/inventory/reorder/plan/${planId}/finalize`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('확정 실패')
      toast.success('발주 계획이 확정되었습니다. 생산차수가 생성됩니다.')
      setFinalizeOpen(false)
      router.push('/d/seller-ops/inventory/reorder/plans')
    } catch (err) {
      console.error(err)
      toast.error('발주 계획 확정에 실패했습니다')
    } finally {
      setFinalizing(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/sh/inventory/reorder/plan/${planId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제 실패')
      toast.success('발주 계획을 삭제했습니다')
      setDeleteOpen(false)
      router.push('/d/seller-ops/inventory/reorder')
    } catch (err) {
      console.error(err)
      toast.error('발주 계획 삭제에 실패했습니다')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        발주 계획을 불러오는 중...
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        발주 계획을 찾을 수 없습니다
      </div>
    )
  }

  const totalFinalQty = items.reduce((sum, it) => sum + it.finalQty, 0)
  // 컬럼 수: 옵션 + 현재고 + 예측 + 모델 + 리드 + 안전 + 제안 + 라운딩 + 최종 + 메모 + 근거
  const colCount = 11

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-md border bg-card px-4 py-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <PackageIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-base font-semibold">{plan.planNo}</span>
            {plan.productName && (
              <span className="text-sm text-muted-foreground">· {plan.productName}</span>
            )}
            {brandName && <span className="text-xs text-muted-foreground">({brandName})</span>}
            <StatusBadge status={plan.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            예측 창 {plan.windowDays}일 · 제안 합계{' '}
            <span className="font-medium tabular-nums">{plan.totalSuggestedQty}</span>개 · 최종 합계{' '}
            <span className="font-medium tabular-nums">{totalFinalQty}</span>개
          </p>
          {!readonly && coldStartCount > 0 && (
            <p className="text-xs text-amber-700">
              데이터 부족 옵션 {coldStartCount}개 — 아래 패널에서 목표 판매량을 설정해 초기 예측을
              보정하세요
            </p>
          )}
          {plan.finalizedAt && (
            <p className="text-xs text-muted-foreground">
              확정일: {new Date(plan.finalizedAt).toLocaleString('ko-KR')}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {plan.status === 'DRAFT' && (
            <Button size="sm" onClick={() => setFinalizeOpen(true)} className="gap-1.5">
              <CheckIcon className="h-3.5 w-3.5" />
              확정
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-muted-foreground hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2Icon className="h-3.5 w-3.5" />
            삭제
          </Button>
        </div>
      </div>

      {/* 콜드스타트 전체 적용 패널 — 데이터부족 옵션 있을 때만 (주 경로) */}
      {!readonly && coldStartCount > 0 && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/50 px-4 py-3">
          <p className="text-xs font-medium text-amber-800">
            초기 예측 보정 · 데이터부족 {coldStartCount}개
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-amber-800">
                목표 일판매량 (개/일)
              </label>
              <Input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                placeholder="목표 일판매량"
                className="h-8 w-32 text-sm"
                value={panelTarget}
                onChange={(e) => setPanelTarget(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-amber-800">시즌 계수</label>
              <Select value={panelSeason} onValueChange={setPanelSeason}>
                <SelectTrigger className="h-8 w-32 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEASON_FACTOR_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" disabled={panelBusy} onClick={handlePanelApply}>
              {panelBusy ? '적용 중...' : '전체 적용'}
            </Button>
          </div>
          <p className="text-[11px] text-amber-700">
            모든 데이터부족 옵션에 동일하게 적용됩니다. 특정 옵션만 다르게 하려면 표의 예측 일판매
            셀에서 개별 조정하세요.
          </p>
        </div>
      )}

      {/* 아이템 테이블 */}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>옵션</TableHead>
              <TableHead className="text-right">현재고</TableHead>
              <TableHead className="text-right">예측 일판매</TableHead>
              <TableHead>모델</TableHead>
              <TableHead className="text-right">리드타임</TableHead>
              <TableHead className="text-right">안전재고</TableHead>
              <TableHead className="text-right">제안수량</TableHead>
              <TableHead className="text-right">라운딩 제안</TableHead>
              <TableHead className="text-right">최종수량</TableHead>
              <TableHead>메모</TableHead>
              <TableHead className="w-8">근거</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colCount}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  발주 항목이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => {
                const opt = optionMap.get(item.optionId)
                const cold = isColdStart(item)

                return (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-1.5">
                        <span>{opt?.optionName ?? '-'}</span>
                        {opt?.optionDeleted && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            삭제됨
                          </Badge>
                        )}
                      </div>
                      {cold && (
                        <Badge
                          variant="outline"
                          className="mt-0.5 border-amber-200 bg-amber-50 text-[10px] text-amber-700"
                        >
                          데이터부족
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.currentStock}</TableCell>
                    <TableCell className="text-right">
                      {cold ? (
                        <ColdStartCell
                          key={`cs-${item.id}-${item.inputsSnapshot?.coldStartInterview?.targetDailySales ?? ''}-${item.inputsSnapshot?.coldStartInterview?.seasonFactor ?? ''}`}
                          item={item}
                          readonly={readonly}
                          onApply={handleCellApply}
                        />
                      ) : (
                        <span className="tabular-nums">{item.dailyAvgForecast.toFixed(2)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ModelBadge model={item.forecastModel} />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {item.leadTimeDays}일
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {item.safetyStockQty}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.suggestedQty}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {item.roundedSuggestedQty}
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        ({item.roundUnit}단위)
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <FinalQtyCell
                        key={`fq-${item.id}-${item.finalQty}`}
                        item={item}
                        readonly={readonly}
                        onSaved={handleFinalQtySaved}
                      />
                    </TableCell>
                    <TableCell>
                      <UserNoteCell
                        key={`note-${item.id}-${item.userNote ?? ''}`}
                        item={item}
                        readonly={readonly}
                        onSaved={handleNoteSaved}
                      />
                    </TableCell>
                    <TableCell>
                      <ReorderPlanRationalePopover item={item} />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* 확정 확인 다이얼로그 */}
      <Dialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>발주 계획 확정</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            확정하면 발주 항목을 기반으로 <strong>생산차수가 자동 생성</strong>됩니다. 계획을
            확정하시겠습니까?
          </p>
          <p className="text-xs text-muted-foreground">
            최종 수량 합계: <span className="font-semibold tabular-nums">{totalFinalQty}개</span>
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinalizeOpen(false)} disabled={finalizing}>
              취소
            </Button>
            <Button onClick={handleFinalize} disabled={finalizing}>
              {finalizing ? '확정 중...' : '확정'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 다이얼로그 */}
      <Dialog open={deleteOpen} onOpenChange={(o) => !o && setDeleteOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>발주 계획 삭제</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{plan.planNo}</span> 계획을
            삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
          </p>
          {plan.status !== 'DRAFT' && (
            <p className="text-xs text-amber-700">
              확정된 계획입니다. 삭제해도 생성된 생산차수는 보존되며, 계획과의 연결만 해제됩니다.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="gap-1.5"
            >
              <Trash2Icon className="h-4 w-4" />
              {deleting ? '삭제 중...' : '삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
