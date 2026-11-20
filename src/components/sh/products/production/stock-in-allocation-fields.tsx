'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isExternalLogisticsLocation } from '@/lib/inv/location-kind'

// 입고 완료 위치 분배 입력 — 입고 완료 다이얼로그와 차수 수정 다이얼로그가 같이 쓴다.
// 입고 완료는 재고를 바로 늘리지 않는다. 「사무실 재고에 입고 등록」을 체크해야 자체 위치 분배분이
// 같은 요청에서 [입고] 건으로 생기고, 아니면 나중에 차수에서 등록한다.

type Location = {
  id: string
  name: string
  type: string
  externalSource?: string | null
  isActive: boolean
}

const isExternalLoc = (l?: Location) => !!l && isExternalLogisticsLocation(l)

export type StockInRunItem = {
  optionId: string
  optionName: string
  quantity: number
}

// 세트 기반 차수의 세트 라인 (있으면 세트 단위 입고 모드)
export type StockInRunSet = {
  id: string
  listingId: string
  listingName: string
  plannedSetQty: number
  stockedInSetQty: number | null
}

export type StockInAllocationRun = {
  id: string
  items: StockInRunItem[]
  sets?: StockInRunSet[]
}

// 옵션별 분배 행 — 한 옵션을 여러 위치로 나눠 입고할 때 각 행이 위치+수량 1건.
type AllocRow = { locationId: string; quantity: number }

export type StockInAllocationValue = {
  loading: boolean
  /** 활성 보관 위치가 하나도 없음 */
  noLocations: boolean
  /** 제출 가능한 입력인지 */
  valid: boolean
  /** transition 요청 본문에 합칠 분배 (allocations 또는 setStockIns) */
  payload: Record<string, unknown>
  /** 사무실 재고에 입고 등록 체크 여부 */
  ownStockIn: boolean
}

type Props = {
  run: StockInAllocationRun
  /** true 일 때 위치·분배 기본값을 불러온다 */
  active: boolean
  onChange: (v: StockInAllocationValue) => void
  /** 입력 잠금(저장 중) */
  disabled?: boolean
}

export function StockInAllocationFields({ run, active, onChange, disabled }: Props) {
  const [locations, setLocations] = useState<Location[]>([])
  const [loadingLocations, setLoadingLocations] = useState(false)
  // 옵션ID → 분배 행 목록
  const [allocByOption, setAllocByOption] = useState<Record<string, AllocRow[]>>({})
  // 세트 단위 입고 모드 — 단일 입고 위치 + listingId → 입고 세트수
  const [stockInLocationId, setStockInLocationId] = useState('')
  const [setQtyByListing, setSetQtyByListing] = useState<Record<string, number>>({})
  // 레이어드 자동 분배 프리필됨(연동 위치 baseline + 사용자 위치 추가분) 여부 — 안내 표시용
  const [layeredSplit, setLayeredSplit] = useState(false)
  // 묶음 상품(세트) 기준 확인 뷰 — baseline 을 세트 구성으로 역산(표시 전용)
  const [baselineSets, setBaselineSets] = useState<
    { listingName: string; setQty: number; items: { optionName: string; perSet: number }[] }[]
  >([])
  const [ownStockIn, setOwnStockIn] = useState(false)

  const isStockIn = active
  // 세트 기반 차수면 세트 단위 입고 모드 (구성옵션 분배는 서버가 처리)
  const isSetRun = (run.sets?.length ?? 0) > 0

  // 활성화될 때마다 초기화
  useEffect(() => {
    if (!active) return
    setAllocByOption({})
    setSetQtyByListing({})
    setStockInLocationId('')
    setLayeredSplit(false)
    setBaselineSets([])
    setOwnStockIn(false)
  }, [active])

  // 위치 로드 → 로드 후 옵션별 기본 1행(전체 수량 → 첫 위치) 초기화.
  // deps 를 run.id 로 고정해 부모 재렌더(run 객체 신규 생성)로 사용자 입력이 초기화되는 것을 막는다.
  const runId = run?.id
  const runItems = run?.items
  const runSets = run?.sets
  useEffect(() => {
    if (!active || !runId) return
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
          /** 발주 계획 검토 단계에서 고른 자체·3PL 입고 위치 */
          ownLocation?: { id: string; name: string } | null
          options: { optionId: string; baselineQty: number; additionalQty: number }[]
          sets?: {
            listingName: string
            setQty: number
            items: { optionName: string; perSet: number }[]
          }[]
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
        // 계획에서 고른 자체·3PL 위치가 목록에 있으면 그 위치가 자체 몫 기본값
        const planOwnLoc = list.find((l) => l.id === split?.ownLocation?.id)?.id
        if (split?.layered && split.rocketLocation) {
          const rocketId = split.rocketLocation.id
          // 추가분 기본 목적지 = 로켓 위치가 아닌 첫 위치(없으면 첫 위치)
          const otherLoc = planOwnLoc ?? list.find((l) => l.id !== rocketId)?.id ?? firstLoc
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
          setBaselineSets((split.sets ?? []).filter((s) => s.setQty > 0))
        } else {
          // 기본: 옵션별 1행(전체 수량 → 첫 위치)
          for (const it of runItems ?? []) {
            init[it.optionId] = [{ locationId: planOwnLoc ?? firstLoc, quantity: it.quantity }]
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
  }, [active, runId])

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
  const ownLocationIds = useMemo(
    () => new Set(locations.filter((l) => !isExternalLoc(l)).map((l) => l.id)),
    [locations]
  )
  // 자체(비외부) 위치로 가는 분배가 있는지 — 입고 등록 체크박스 노출 조건
  const hasOwnSelected = useMemo(() => {
    if (isSetRun) return ownLocationIds.has(stockInLocationId)
    return Object.values(allocByOption).some((rows) =>
      rows.some((r) => r.quantity > 0 && ownLocationIds.has(r.locationId))
    )
  }, [isSetRun, stockInLocationId, allocByOption, ownLocationIds])

  const payload = useMemo<Record<string, unknown>>(() => {
    if (isSetRun) {
      // 세트 단위: setQty>0 세트만 → 단일 위치로 setStockIns (서버가 구성옵션 분해)
      return {
        setStockIns: (run.sets ?? [])
          .filter((s) => (setQtyByListing[s.listingId] ?? 0) > 0)
          .map((s) => ({
            listingId: s.listingId,
            locationId: stockInLocationId,
            setQty: setQtyByListing[s.listingId],
          })),
      }
    }
    // quantity 0 행은 "그 위치 미배정" → 제외 (서버 Zod .positive() 와 일치, allValid 와 동일 술어)
    return {
      allocations: run.items.flatMap((it) =>
        (allocByOption[it.optionId] ?? [])
          .filter((r) => r.quantity > 0)
          .map((r) => ({ optionId: it.optionId, locationId: r.locationId, quantity: r.quantity }))
      ),
    }
  }, [isSetRun, run.sets, run.items, setQtyByListing, stockInLocationId, allocByOption])

  const noLocations = active && !loadingLocations && locations.length === 0
  const valid =
    active &&
    !loadingLocations &&
    locations.length > 0 &&
    (isSetRun ? !!stockInLocationId : allValid)
  const effectiveOwn = ownStockIn && hasOwnSelected

  // 부모가 run 객체를 매 렌더 새로 만들어도 값이 같으면 다시 알리지 않는다(렌더 루프 방지)
  const lastEmitted = useRef('')
  useEffect(() => {
    if (!active) {
      lastEmitted.current = ''
      return
    }
    const value: StockInAllocationValue = {
      loading: loadingLocations,
      noLocations,
      valid,
      payload: { ...payload, ownStockIn: effectiveOwn },
      ownStockIn: effectiveOwn,
    }
    const key = JSON.stringify(value)
    if (key === lastEmitted.current) return
    lastEmitted.current = key
    onChange(value)
  })

  if (!active) return null

  return (
    <div className="space-y-4">
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
                  자체창고·연동위치 모두 선택 가능. 세트수는 구성옵션으로 자동 분해되어 입고됩니다.
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
                            <span className={`ml-1.5 font-medium ${diffClass}`}>({diffLabel})</span>
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
                                [s.listingId]: e.target.value === '' ? 0 : Number(e.target.value),
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
            <div className="space-y-2 rounded-md border border-indigo-200 bg-indigo-50/50 px-3 py-2 text-xs text-indigo-700">
              <p>
                연동 위치 기본 입고분은 연동 위치로, 추가분은 사용자 위치로 자동 분배했습니다.
                실입고에 맞게 위치·수량을 조정하세요.
              </p>
              {baselineSets.length > 0 && (
                <div className="space-y-1 border-t border-indigo-200/70 pt-1.5">
                  <p className="font-medium">묶음 상품(세트) 기준 확인 · 연동 위치 baseline</p>
                  <ul className="space-y-0.5">
                    {baselineSets.map((s, i) => (
                      <li
                        key={`${s.listingName}-${i}`}
                        className="flex flex-wrap items-baseline gap-x-2"
                      >
                        <span className="font-medium text-foreground">{s.listingName}</span>
                        <span className="tabular-nums">{s.setQty}세트</span>
                        <span className="text-indigo-600/80">
                          ({s.items.map((it) => `${it.optionName}×${it.perSet}`).join(' + ')})
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-indigo-600/70">
                    구성 옵션이 겹치는 세트는 각각 대안 환산입니다(합산 아님). 실제 입고는 옵션
                    단위.
                  </p>
                </div>
              )}
            </div>
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
                            onValueChange={(v) => updateRow(it.optionId, idx, { locationId: v })}
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

      {hasOwnSelected && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
          <Checkbox
            id="own-stock-in"
            checked={ownStockIn}
            disabled={disabled}
            onCheckedChange={(v) => setOwnStockIn(v === true)}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <Label htmlFor="own-stock-in" className="text-sm font-medium">
              사무실 재고에 입고 등록
            </Label>
            <p className="text-xs text-muted-foreground">
              체크하면 재고 위치에 [입고] 건이 생깁니다. 나중에 차수에서 등록할 수도 있습니다
            </p>
          </div>
        </div>
      )}

      <p className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-700">
        입고 완료만으로는 재고가 늘지 않습니다. 연동·외부 위치는 재고 대조로, 사무실 등 자체 위치는
        입고 등록으로 반영되며 그 전까지는 입고 예정으로 계산됩니다.
      </p>
    </div>
  )
}
