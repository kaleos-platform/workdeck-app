'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
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

type Location = {
  id: string
  name: string
  type: string
  isActive: boolean
  externalSource: string | null
}

export type TransferSet = {
  listingId: string
  listingName: string
  plannedSetQty: number
  stockedInSetQty: number | null
}

export type TransferRun = {
  id: string
  runNo: string
  sets: TransferSet[]
  // 입고된 자체창고 (이관 출발지) — 게이팅에서 externalSource=null 만 통과
  fromLocation: { id: string; name: string }
  // 연계 발주 계획의 대상 연동 위치 (도착지 기본값)
  planLocationId: string | null
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  run: TransferRun | null
  onSaved: () => void
}

function todayYMD() {
  return new Date().toISOString().slice(0, 10)
}

export function SetTransferDialog({ open, onOpenChange, run, onSaved }: Props) {
  const [movementDate, setMovementDate] = useState(todayYMD())
  const [locations, setLocations] = useState<Location[]>([])
  const [loadingLocations, setLoadingLocations] = useState(false)
  const [toLocationId, setToLocationId] = useState('')
  const [setQtyByListing, setSetQtyByListing] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)

  // 도착지 후보 = 연동 위치(externalSource != null), 출발지 제외
  const connectedLocations = useMemo(
    () => locations.filter((l) => l.externalSource != null && l.id !== run?.fromLocation.id),
    [locations, run?.fromLocation.id]
  )

  // 열릴 때 초기화 + 위치 로드
  const runId = run?.id
  const planLocationId = run?.planLocationId
  const runSets = run?.sets
  useEffect(() => {
    if (!open || !runId) return
    setMovementDate(todayYMD())
    // 세트별 기본 이관 수량 = 입고된 세트수(없으면 발주 세트수)
    const initQty: Record<string, number> = {}
    for (const s of runSets ?? []) initQty[s.listingId] = s.stockedInSetQty ?? s.plannedSetQty
    setSetQtyByListing(initQty)

    let cancelled = false
    setLoadingLocations(true)
    fetch('/api/sh/inventory/locations?isActive=true')
      .then((r) => r.json())
      .then((d: { locations?: Location[] }) => {
        if (cancelled) return
        const list = d.locations ?? []
        setLocations(list)
        const connected = list.filter(
          (l) => l.externalSource != null && l.id !== run?.fromLocation.id
        )
        // 기본 도착지 = 계획 대상 위치(연동 위치면), 없으면 첫 연동 위치
        const planConnected = connected.find((l) => l.id === planLocationId)
        setToLocationId(planConnected?.id ?? connected[0]?.id ?? '')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runId])

  const totalSets = useMemo(
    () => Object.values(setQtyByListing).reduce((s, q) => s + (Number.isFinite(q) ? q : 0), 0),
    [setQtyByListing]
  )

  async function handleSubmit() {
    if (!run) return
    if (!toLocationId) {
      toast.error('이관할 연동 위치를 선택하세요')
      return
    }
    if (totalSets <= 0) {
      toast.error('이관할 세트 수량을 입력하세요')
      return
    }
    setSaving(true)
    try {
      const transfers = (run.sets ?? [])
        .filter((s) => (setQtyByListing[s.listingId] ?? 0) > 0)
        .map((s) => ({ listingId: s.listingId, setQty: setQtyByListing[s.listingId] }))
      const res = await fetch('/api/sh/inventory/set-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: run.id,
          fromLocationId: run.fromLocation.id,
          toLocationId,
          movementDate,
          transfers,
        }),
      })
      if (!res.ok) {
        const err: { message?: string } = await res.json().catch(() => ({}))
        throw new Error(err.message ?? '세트 이관 실패')
      }
      toast.success(`세트 ${totalSets.toLocaleString('ko-KR')}개 이관 완료`)
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '세트 이관 실패')
    } finally {
      setSaving(false)
    }
  }

  if (!run) return null

  const toName = connectedLocations.find((l) => l.id === toLocationId)?.name ?? ''
  const noConnected = !loadingLocations && connectedLocations.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>세트 조립·이관 · 차수 {run.runNo}</DialogTitle>
          <DialogDescription>
            자체창고({run.fromLocation.name})의 구성옵션을 세트로 조립해 연동 위치로 이관합니다.
            구성옵션이 부족하면 이관이 차단됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 출발지 → 도착지 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 space-y-1.5">
              <Label>출발지 (자체창고)</Label>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                {run.fromLocation.name}
              </div>
            </div>
            <ArrowRight className="mt-6 size-4 shrink-0 text-muted-foreground" />
            <div className="flex-1 space-y-1.5">
              <Label>
                도착지 (연동 위치)<span className="ml-0.5 text-destructive">*</span>
              </Label>
              {loadingLocations ? (
                <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
                  불러오는 중...
                </div>
              ) : noConnected ? (
                <div className="rounded-md border border-border px-3 py-2 text-xs text-destructive">
                  연동 위치가 없습니다
                </div>
              ) : (
                <Select value={toLocationId} onValueChange={setToLocationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="연동 위치 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {connectedLocations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* 이관 일자 */}
          <div className="space-y-1.5">
            <Label htmlFor="transferDate">이관 일자</Label>
            <Input
              id="transferDate"
              type="date"
              value={movementDate}
              onChange={(e) => setMovementDate(e.target.value)}
            />
          </div>

          {/* 세트별 이관 수량 */}
          <div className="space-y-1.5">
            <Label>
              세트별 이관 수량<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
              {(run.sets ?? []).map((s) => {
                const qty = setQtyByListing[s.listingId] ?? 0
                return (
                  <div
                    key={s.listingId}
                    className="flex items-center justify-between gap-2 rounded-md border border-border p-2.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{s.listingName}</div>
                      <div className="text-xs text-muted-foreground">
                        입고 {(s.stockedInSetQty ?? 0).toLocaleString('ko-KR')}세트
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
            <p className="text-xs text-muted-foreground">
              총 {totalSets.toLocaleString('ko-KR')}세트{toName ? ` → ${toName}` : ''} 이관
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || loadingLocations || noConnected || !toLocationId || totalSets <= 0}
          >
            {saving ? '이관 중...' : '조립·이관'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
