'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

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

export type TransitionTarget = 'PLANNED' | 'ORDERED' | 'STOCKED_IN'

const STATUS_LABEL: Record<TransitionTarget, string> = {
  PLANNED: '계획중',
  ORDERED: '발주완료',
  STOCKED_IN: '입고완료',
}

type Location = {
  id: string
  name: string
  type: string
  isActive: boolean
}

type RunItem = {
  optionId: string
  optionName: string
  quantity: number
}

// 세트 기반 차수의 세트 라인 (있으면 세트 단위 입고 모드)
type RunSet = {
  id: string
  listingId: string
  listingName: string
  plannedSetQty: number
  stockedInSetQty: number | null
}

type RunSummary = {
  id: string
  runNo: string
  totalQuantity: number
  itemCount: number
  items: RunItem[]
  sets?: RunSet[]
}

// 옵션별 분배 행 — 한 옵션을 여러 위치로 나눠 입고할 때 각 행이 위치+수량 1건.
type AllocRow = { locationId: string; quantity: number }

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  target: TransitionTarget | null
  run: RunSummary | null
  onSaved: () => void
}

function todayYMD() {
  return new Date().toISOString().slice(0, 10)
}

export function ProductionRunTransitionDialog({ open, onOpenChange, target, run, onSaved }: Props) {
  const [transitionDate, setTransitionDate] = useState(todayYMD())
  const [locations, setLocations] = useState<Location[]>([])
  const [loadingLocations, setLoadingLocations] = useState(false)
  const [saving, setSaving] = useState(false)
  // 옵션ID → 분배 행 목록
  const [allocByOption, setAllocByOption] = useState<Record<string, AllocRow[]>>({})
  // 세트 단위 입고 모드 — 단일 입고 위치 + listingId → 입고 세트수
  const [stockInLocationId, setStockInLocationId] = useState('')
  const [setQtyByListing, setSetQtyByListing] = useState<Record<string, number>>({})
  // 레이어드 자동 분배 프리필됨(연동 위치 baseline + 사용자 위치 추가분) 여부 — 안내 표시용
  const [layeredSplit, setLayeredSplit] = useState(false)

  const isStockIn = target === 'STOCKED_IN'
  // 세트 기반 차수면 세트 단위 입고 모드 (구성옵션 분배는 서버가 처리)
  const isSetRun = isStockIn && (run?.sets?.length ?? 0) > 0

  // 다이얼로그 열릴 때 초기화
  useEffect(() => {
    if (!open) return
    setTransitionDate(todayYMD())
    setAllocByOption({})
    setSetQtyByListing({})
    setStockInLocationId('')
    setLayeredSplit(false)
  }, [open])

  // STOCKED_IN 일 때만 위치 로드 → 로드 후 옵션별 기본 1행(전체 수량 → 첫 위치) 초기화.
  // deps 를 run.id 로 고정해 부모 재렌더(run 객체 신규 생성)로 사용자 입력이 초기화되는 것을 막는다.
  const runId = run?.id
  const runItems = run?.items
  const runSets = run?.sets
  useEffect(() => {
    if (!open || !isStockIn || !runId) return
    let cancelled = false
    setLoadingLocations(true)
    setLayeredSplit(false)
    ;(async () => {
      try {
        const d: { locations?: Location[] } = await fetch(
          '/api/sh/inventory/locations?isActive=true'
        ).then((r) => r.json())
        if (cancelled) return
        const list = d.locations ?? []
        setLocations(list)
        const firstLoc = list[0]?.id ?? ''

        if ((runSets?.length ?? 0) > 0) {
          // 세트 모드: 단일 입고 위치 + 세트별 입고세트수(기본=발주 세트수)
          setStockInLocationId(firstLoc)
          const initSet: Record<string, number> = {}
          for (const s of runSets ?? []) initSet[s.listingId] = s.plannedSetQty
          setSetQtyByListing(initSet)
          return
        }

        // 옵션 모드 — 레이어드 차수면 서버 분할(baseline/추가분)로 연동 위치·사용자 위치 2행 자동 프리필.
        type Split = {
          layered: boolean
          rocketLocation: { id: string; name: string } | null
          options: { optionId: string; baselineQty: number; additionalQty: number }[]
        }
        let split: Split | null = null
        try {
          split = await fetch(`/api/sh/production-runs/${runId}/stockin-split`).then((r) =>
            r.ok ? (r.json() as Promise<Split>) : null
          )
        } catch {
          split = null
        }
        if (cancelled) return

        const init: Record<string, AllocRow[]> = {}
        if (split?.layered && split.rocketLocation) {
          const rocketId = split.rocketLocation.id
          // 추가분 기본 목적지 = 로켓 위치가 아닌 첫 위치(없으면 첫 위치)
          const otherLoc = list.find((l) => l.id !== rocketId)?.id ?? firstLoc
          const byOpt = new Map(split.options.map((o) => [o.optionId, o]))
          for (const it of runItems ?? []) {
            const s = byOpt.get(it.optionId)
            const rows: AllocRow[] = []
            if (s && s.baselineQty > 0) rows.push({ locationId: rocketId, quantity: s.baselineQty })
            const additional = s ? s.additionalQty : it.quantity
            if (additional > 0 || rows.length === 0) {
              rows.push({ locationId: otherLoc, quantity: additional })
            }
            init[it.optionId] = rows
          }
          setLayeredSplit(true)
        } else {
          // 기본: 옵션별 1행(전체 수량 → 첫 위치)
          for (const it of runItems ?? []) {
            init[it.optionId] = [{ locationId: firstLoc, quantity: it.quantity }]
          }
        }
        setAllocByOption(init)
      } catch {
        if (!cancelled) toast.error('보관 위치를 불러올 수 없습니다')
      } finally {
        if (!cancelled) setLoadingLocations(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // runItems 는 runId 가 같으면 동일 차수 → 의도적으로 deps 제외 (부모 재렌더 시 입력 보존)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isStockIn, runId])

  // 옵션별 합계 + 일치 여부
  const optionSums = useMemo(() => {
    const map: Record<string, number> = {}
    for (const [optionId, rows] of Object.entries(allocByOption)) {
      map[optionId] = rows.reduce((s, r) => s + (Number.isFinite(r.quantity) ? r.quantity : 0), 0)
    }
    return map
  }, [allocByOption])

  // 실입고량은 발주 수량과 달라도 됨(양방향). 0 행은 "그 위치 미배정"으로 제출 시 제외되므로 통과.
  // 양수 행만 위치 선택 + 정수 검증. 한 옵션 전 행 0 = 미입고(stockedInQty=0, 허용).
  // submit 의 quantity>0 필터와 동일 술어를 써야 표시 상태와 제출 상태가 어긋나지 않음.
  const allValid = useMemo(() => {
    if (!run) return false
    return run.items.every((it) => {
      const rows = allocByOption[it.optionId] ?? []
      return rows.every(
        (r) =>
          r.quantity === 0 ||
          (r.locationId !== '' && Number.isInteger(r.quantity) && r.quantity > 0)
      )
    })
  }, [run, allocByOption])

  function updateRow(optionId: string, idx: number, patch: Partial<AllocRow>) {
    setAllocByOption((prev) => {
      const rows = prev[optionId] ?? []
      const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r))
      return { ...prev, [optionId]: next }
    })
  }

  function addRow(optionId: string) {
    setAllocByOption((prev) => {
      const rows = prev[optionId] ?? []
      const firstLoc = locations[0]?.id ?? ''
      return { ...prev, [optionId]: [...rows, { locationId: firstLoc, quantity: 0 }] }
    })
  }

  function removeRow(optionId: string, idx: number) {
    setAllocByOption((prev) => {
      const rows = prev[optionId] ?? []
      return { ...prev, [optionId]: rows.filter((_, i) => i !== idx) }
    })
  }

  async function handleSubmit() {
    if (!run || !target) return
    if (!transitionDate) {
      toast.error('전환 일자를 입력하세요')
      return
    }

    if (isStockIn) {
      if (locations.length === 0) {
        toast.error('활성화된 보관 위치가 없습니다')
        return
      }
      if (isSetRun) {
        if (!stockInLocationId) {
          toast.error('입고 위치를 선택하세요')
          return
        }
      } else if (!allValid) {
        toast.error('입고 행의 위치와 수량(1개 이상)을 확인하세요')
        return
      }
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        status: target,
        transitionDate,
      }
      if (isStockIn) {
        if (isSetRun) {
          // 세트 단위: setQty>0 세트만 → 단일 위치로 setStockIns (서버가 구성옵션 분해)
          body.setStockIns = (run.sets ?? [])
            .filter((s) => (setQtyByListing[s.listingId] ?? 0) > 0)
            .map((s) => ({
              listingId: s.listingId,
              locationId: stockInLocationId,
              setQty: setQtyByListing[s.listingId],
            }))
        } else {
          // quantity 0 행은 "그 위치 미배정" → 제외 (서버 Zod .positive() 와 일치, allValid 와 동일 술어)
          const allocations = run.items.flatMap((it) =>
            (allocByOption[it.optionId] ?? [])
              .filter((r) => r.quantity > 0)
              .map((r) => ({
                optionId: it.optionId,
                locationId: r.locationId,
                quantity: r.quantity,
              }))
          )
          body.allocations = allocations
        }
      }

      const res = await fetch(`/api/sh/production-runs/${run.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err: { message?: string } = await res.json().catch(() => ({}))
        throw new Error(err.message ?? '상태 변경 실패')
      }
      toast.success(`차수 ${run.runNo} ${STATUS_LABEL[target]} 처리 완료`)
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '상태 변경 실패')
    } finally {
      setSaving(false)
    }
  }

  if (!target || !run) return null

  const noLocations = isStockIn && !loadingLocations && locations.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {run.runNo} · {STATUS_LABEL[target]} 전환
          </DialogTitle>
          <DialogDescription>
            {isSetRun
              ? `세트 ${run.sets?.length ?? 0}종. 세트 단위로 입고하면 구성옵션으로 자동 분해됩니다. 실제 입고 세트수는 발주와 달라도 됩니다(부족·초과·미입고 가능).`
              : isStockIn
                ? `옵션 ${run.itemCount}개 · 발주 ${run.totalQuantity.toLocaleString('ko-KR')}개. 실제 입고 수량은 발주와 달라도 됩니다(부족·초과·미입고 가능).`
                : target === 'PLANNED'
                  ? '계획중 상태로 되돌립니다. 기존 발주완료·입고완료 일자는 이력으로 유지됩니다.'
                  : '전환 일자를 확인하고 상태를 변경합니다.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {target !== 'PLANNED' && (
            <div className="space-y-1.5">
              <Label htmlFor="transitionDate">
                {isStockIn ? '입고 일자' : '발주일'}
                <span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="transitionDate"
                type="date"
                value={transitionDate}
                onChange={(e) => setTransitionDate(e.target.value)}
              />
            </div>
          )}

          {/* ── 세트 단위 입고 (세트 기반 차수) ── */}
          {isSetRun && (
            <div className="space-y-3">
              {loadingLocations && (
                <p className="text-xs text-muted-foreground">보관 위치를 불러오는 중...</p>
              )}
              {noLocations && (
                <p className="text-xs text-destructive">
                  활성화된 보관 위치가 없습니다. 재고 설정에서 위치를 먼저 추가하세요.
                </p>
              )}
              {!loadingLocations && locations.length > 0 && (
                <>
                  <div className="space-y-1.5">
                    <Label>
                      입고 위치<span className="ml-0.5 text-destructive">*</span>
                    </Label>
                    <Select value={stockInLocationId} onValueChange={setStockInLocationId}>
                      <SelectTrigger>
                        <SelectValue placeholder="입고 위치 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id}>
                            {loc.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      자체창고·연동위치 모두 선택 가능. 세트수는 구성옵션으로 자동 분해되어
                      입고됩니다.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label>
                      세트별 입고 수량<span className="ml-0.5 text-destructive">*</span>
                    </Label>
                    <div className="max-h-[44vh] space-y-2 overflow-y-auto pr-1">
                      {(run.sets ?? []).map((s) => {
                        const qty = setQtyByListing[s.listingId] ?? 0
                        const diff = qty - s.plannedSetQty
                        const diffLabel =
                          diff === 0
                            ? '일치'
                            : diff > 0
                              ? `초과 +${diff.toLocaleString('ko-KR')}`
                              : `부족 ${diff.toLocaleString('ko-KR')}`
                        const diffClass =
                          diff === 0
                            ? 'text-muted-foreground'
                            : diff > 0
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-amber-600 dark:text-amber-400'
                        return (
                          <div
                            key={s.listingId}
                            className="flex items-center justify-between gap-2 rounded-md border border-border p-2.5"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{s.listingName}</div>
                              <div className="text-xs">
                                <span className="text-muted-foreground">
                                  발주 {s.plannedSetQty.toLocaleString('ko-KR')}세트
                                </span>
                                <span className={`ml-1.5 font-medium ${diffClass}`}>
                                  ({diffLabel})
                                </span>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <Input
                                type="number"
                                min={0}
                                className="w-24"
                                value={Number.isFinite(qty) ? qty : ''}
                                onChange={(e) =>
                                  setSetQtyByListing((prev) => ({
                                    ...prev,
                                    [s.listingId]:
                                      e.target.value === '' ? 0 : Number(e.target.value),
                                  }))
                                }
                              />
                              <span className="text-xs text-muted-foreground">세트</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {isStockIn && !isSetRun && (
            <div className="space-y-1.5">
              <Label>
                옵션별 보관 위치<span className="ml-0.5 text-destructive">*</span>
              </Label>

              {layeredSplit && (
                <p className="rounded-md border border-indigo-200 bg-indigo-50/50 px-3 py-2 text-xs text-indigo-700">
                  연동 위치 발주(레이어드) — baseline 분은 연동 위치로, 추가분은 사용자 위치로 자동
                  분배했습니다(묶음 상품 발주 기준). 실입고에 맞게 위치·수량을 조정하세요.
                </p>
              )}

              {loadingLocations && (
                <p className="text-xs text-muted-foreground">보관 위치를 불러오는 중...</p>
              )}

              {noLocations && (
                <p className="text-xs text-destructive">
                  활성화된 보관 위치가 없습니다. 재고 설정에서 위치를 먼저 추가하세요.
                </p>
              )}

              {!loadingLocations && locations.length > 0 && (
                <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
                  {run.items.map((it) => {
                    const rows = allocByOption[it.optionId] ?? []
                    const sum = optionSums[it.optionId] ?? 0
                    const diff = sum - it.quantity // +초과 / -부족 / 0 일치
                    const diffLabel =
                      diff === 0
                        ? '일치'
                        : diff > 0
                          ? `초과 +${diff.toLocaleString('ko-KR')}`
                          : `부족 ${diff.toLocaleString('ko-KR')}`
                    const diffClass =
                      diff === 0
                        ? 'text-muted-foreground'
                        : diff > 0
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-amber-600 dark:text-amber-400'
                    return (
                      <div key={it.optionId} className="rounded-md border border-border p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{it.optionName}</span>
                          <span className="flex items-center gap-1.5 text-xs">
                            <span className="text-muted-foreground">
                              입고 {sum.toLocaleString('ko-KR')} / 발주{' '}
                              {it.quantity.toLocaleString('ko-KR')}개
                            </span>
                            <span className={`font-medium ${diffClass}`}>({diffLabel})</span>
                          </span>
                        </div>

                        <div className="space-y-2">
                          {rows.map((row, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <Select
                                value={row.locationId}
                                onValueChange={(v) =>
                                  updateRow(it.optionId, idx, { locationId: v })
                                }
                              >
                                <SelectTrigger className="flex-1">
                                  <SelectValue placeholder="위치 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                  {locations.map((loc) => (
                                    <SelectItem key={loc.id} value={loc.id}>
                                      {loc.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Input
                                type="number"
                                min={1}
                                className="w-24"
                                value={Number.isFinite(row.quantity) ? row.quantity : ''}
                                onChange={(e) =>
                                  updateRow(it.optionId, idx, {
                                    quantity: e.target.value === '' ? 0 : Number(e.target.value),
                                  })
                                }
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="shrink-0"
                                onClick={() => removeRow(it.optionId, idx)}
                                aria-label="입고 행 삭제"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          ))}
                        </div>

                        {rows.length === 0 && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            미입고 (이 옵션은 입고하지 않음)
                          </p>
                        )}

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-2 h-7 px-2 text-xs"
                          onClick={() => addRow(it.optionId)}
                        >
                          <Plus className="mr-1 size-3.5" />{' '}
                          {rows.length === 0 ? '입고 행 추가' : '분할 추가'}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              saving ||
              (isStockIn &&
                (loadingLocations ||
                  locations.length === 0 ||
                  (isSetRun ? !stockInLocationId : !allValid)))
            }
          >
            {saving ? '처리 중...' : '확인'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
