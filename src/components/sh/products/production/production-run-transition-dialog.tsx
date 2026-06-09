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

type RunSummary = {
  id: string
  runNo: string
  totalQuantity: number
  itemCount: number
  items: RunItem[]
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

  const isStockIn = target === 'STOCKED_IN'

  // 다이얼로그 열릴 때 초기화
  useEffect(() => {
    if (!open) return
    setTransitionDate(todayYMD())
    setAllocByOption({})
  }, [open])

  // STOCKED_IN 일 때만 위치 로드 → 로드 후 옵션별 기본 1행(전체 수량 → 첫 위치) 초기화.
  // deps 를 run.id 로 고정해 부모 재렌더(run 객체 신규 생성)로 사용자 입력이 초기화되는 것을 막는다.
  const runId = run?.id
  const runItems = run?.items
  useEffect(() => {
    if (!open || !isStockIn || !runId) return
    let cancelled = false
    setLoadingLocations(true)
    fetch('/api/sh/inventory/locations?isActive=true')
      .then((r) => r.json())
      .then((d: { locations?: Location[] }) => {
        if (cancelled) return
        const list = d.locations ?? []
        setLocations(list)
        const firstLoc = list[0]?.id ?? ''
        const init: Record<string, AllocRow[]> = {}
        for (const it of runItems ?? []) {
          init[it.optionId] = [{ locationId: firstLoc, quantity: it.quantity }]
        }
        setAllocByOption(init)
      })
      .catch(() => {
        if (!cancelled) toast.error('보관 위치를 불러올 수 없습니다')
      })
      .finally(() => {
        if (!cancelled) setLoadingLocations(false)
      })
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

  // 클라/서버 검증 일치: 0·NaN·빈 행은 서버 Zod(.positive())가 거부하므로 여기서도 막는다.
  const allMatched = useMemo(() => {
    if (!run) return false
    return run.items.every((it) => {
      const rows = allocByOption[it.optionId] ?? []
      if (rows.length === 0) return false
      if (!rows.every((r) => Number.isInteger(r.quantity) && r.quantity > 0)) return false
      return rows.reduce((s, r) => s + r.quantity, 0) === it.quantity
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
      if (!allMatched) {
        toast.error('옵션별 분배 수량 합을 발주 수량과 일치시키세요')
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
        const allocations = run.items.flatMap((it) =>
          (allocByOption[it.optionId] ?? []).map((r) => ({
            optionId: it.optionId,
            locationId: r.locationId,
            quantity: r.quantity,
          }))
        )
        body.allocations = allocations
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
            {isStockIn
              ? `옵션 ${run.itemCount}개 · 총 수량 ${run.totalQuantity.toLocaleString('ko-KR')}개를 옵션별 보관 위치에 입고합니다.`
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

          {isStockIn && (
            <div className="space-y-1.5">
              <Label>
                옵션별 보관 위치<span className="ml-0.5 text-destructive">*</span>
              </Label>

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
                    const matched = sum === it.quantity
                    return (
                      <div key={it.optionId} className="rounded-md border border-border p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{it.optionName}</span>
                          <span
                            className={
                              matched
                                ? 'text-xs text-muted-foreground'
                                : 'text-xs font-medium text-destructive'
                            }
                          >
                            {sum.toLocaleString('ko-KR')} / {it.quantity.toLocaleString('ko-KR')}개
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
                              {rows.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="shrink-0"
                                  onClick={() => removeRow(it.optionId, idx)}
                                  aria-label="분배 행 삭제"
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-2 h-7 px-2 text-xs"
                          onClick={() => addRow(it.optionId)}
                        >
                          <Plus className="mr-1 size-3.5" /> 분할 추가
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
              saving || (isStockIn && (loadingLocations || locations.length === 0 || !allMatched))
            }
          >
            {saving ? '처리 중...' : '확인'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
