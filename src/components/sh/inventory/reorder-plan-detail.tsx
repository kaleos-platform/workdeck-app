'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckIcon, PackageIcon } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { ReorderPlanRationalePopover } from './reorder-plan-rationale-popover'
import { ColdStartInterviewDialog } from './cold-start-interview-dialog'
import type {
  ForecastModel,
  PlanDetailResponse,
  ReorderPlan,
  ReorderPlanItem,
  ProductInfo,
} from './reorder-plan-types'

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

// 상품/옵션 정보 빠른 조회용 맵 빌드
function buildInfoMap(productInfo: ProductInfo[]) {
  const productMap = new Map<string, ProductInfo>()
  const optionMap = new Map<
    string,
    { optionName: string; sku: string | null; productId: string; optionDeleted?: boolean }
  >()
  for (const p of productInfo) {
    productMap.set(p.productId, p)
    for (const o of p.options) {
      optionMap.set(o.optionId, {
        optionName: o.optionName,
        sku: o.sku,
        productId: p.productId,
        optionDeleted: o.optionDeleted,
      })
    }
  }
  return { productMap, optionMap }
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

  const { productMap, optionMap } = useMemo(() => buildInfoMap(productInfo), [productInfo])

  // 같은 productId 연속 첫 행 감지
  const firstRowByProduct = useMemo(() => {
    const seen = new Set<string>()
    return items.map((item) => {
      if (seen.has(item.productId)) return false
      seen.add(item.productId)
      return true
    })
  }, [items])

  // COLD_START 옵션 목록
  const coldStartItems = useMemo(() => {
    return items
      .filter((item) => item.inputsSnapshot?.profile === 'COLD_START')
      .map((item) => {
        const opt = optionMap.get(item.optionId)
        const prod = productMap.get(item.productId)
        return {
          optionId: item.optionId,
          inputsSnapshot: item.inputsSnapshot,
          productName: prod?.productName ?? '',
          optionName: opt?.optionName ?? '',
        }
      })
  }, [items, optionMap, productMap])

  const readonly = plan?.status !== 'DRAFT'

  const handlePatchItem = useCallback(
    async (itemId: string, body: { finalQty?: number; userNote?: string }) => {
      try {
        const res = await fetch(`/api/sh/inventory/reorder/plan/${planId}/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error('저장 실패')
        // 로컬 상태 업데이트
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

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-md border bg-card px-4 py-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <PackageIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-base font-semibold">{plan.planNo}</span>
            <StatusBadge status={plan.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            예측 창 {plan.windowDays}일 · 제안 합계{' '}
            <span className="font-medium tabular-nums">{plan.totalSuggestedQty}</span>개 · 최종 합계{' '}
            <span className="font-medium tabular-nums">{totalFinalQty}</span>개
          </p>
          {plan.finalizedAt && (
            <p className="text-xs text-muted-foreground">
              확정일: {new Date(plan.finalizedAt).toLocaleString('ko-KR')}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {coldStartItems.length > 0 && (
            <ColdStartInterviewDialog
              planId={planId}
              coldStartItems={coldStartItems}
              onCompleted={fetchPlan}
            />
          )}
          {plan.status === 'DRAFT' && (
            <Button size="sm" onClick={() => setFinalizeOpen(true)} className="gap-1.5">
              <CheckIcon className="h-3.5 w-3.5" />
              확정
            </Button>
          )}
        </div>
      </div>

      {/* 아이템 테이블 */}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>상품</TableHead>
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
                <TableCell colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
                  발주 항목이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              items.map((item, idx) => {
                const isFirst = firstRowByProduct[idx]
                const opt = optionMap.get(item.optionId)
                const prod = productMap.get(item.productId)
                const isColdStart = item.inputsSnapshot?.profile === 'COLD_START'

                return (
                  <TableRow key={item.id} className={isFirst ? 'border-t-2 border-t-muted' : ''}>
                    <TableCell className="font-medium">
                      {isFirst ? (prod?.productName ?? '-') : ''}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-1.5">
                        <span>{opt?.optionName ?? '-'}</span>
                        {opt?.optionDeleted && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            삭제됨
                          </Badge>
                        )}
                      </div>
                      {prod?.brandName && isFirst && (
                        <div className="text-xs text-muted-foreground">{prod.brandName}</div>
                      )}
                      {isColdStart && (
                        <Badge
                          variant="outline"
                          className="mt-0.5 border-amber-200 bg-amber-50 text-[10px] text-amber-700"
                        >
                          데이터부족
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.currentStock}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.dailyAvgForecast.toFixed(2)}
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
                      <FinalQtyCell item={item} readonly={readonly} onSaved={handleFinalQtySaved} />
                    </TableCell>
                    <TableCell>
                      <UserNoteCell item={item} readonly={readonly} onSaved={handleNoteSaved} />
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
    </div>
  )
}
