'use client'

import { useEffect, useState } from 'react'
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

type RunSummary = {
  id: string
  runNo: string
  totalQuantity: number
  itemCount: number
}

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
  const [locationId, setLocationId] = useState<string>('')
  const [locations, setLocations] = useState<Location[]>([])
  const [loadingLocations, setLoadingLocations] = useState(false)
  const [saving, setSaving] = useState(false)

  // 다이얼로그 열릴 때 초기화
  useEffect(() => {
    if (!open) return
    setTransitionDate(todayYMD())
    setLocationId('')
  }, [open])

  // STOCKED_IN 일 때만 위치 로드
  useEffect(() => {
    if (!open || target !== 'STOCKED_IN') return
    let cancelled = false
    setLoadingLocations(true)
    fetch('/api/sh/inventory/locations?isActive=true')
      .then((r) => r.json())
      .then((d: { locations?: Location[] }) => {
        if (cancelled) return
        const list = d.locations ?? []
        setLocations(list)
        if (list.length > 0) setLocationId(list[0].id)
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
  }, [open, target])

  async function handleSubmit() {
    if (!run || !target) return
    if (!transitionDate) {
      toast.error('전환 일자를 입력하세요')
      return
    }
    if (target === 'STOCKED_IN' && !locationId) {
      toast.error('보관 위치를 선택하세요')
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        status: target,
        transitionDate,
      }
      if (target === 'STOCKED_IN') body.locationId = locationId

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

  const isStockIn = target === 'STOCKED_IN'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {run.runNo} · {STATUS_LABEL[target]} 전환
          </DialogTitle>
          <DialogDescription>
            {isStockIn
              ? `옵션 ${run.itemCount}개 · 총 수량 ${run.totalQuantity.toLocaleString('ko-KR')}개를 선택한 보관 위치에 입고합니다.`
              : '전환 일자를 확인하고 상태를 변경합니다.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="transitionDate">
              {isStockIn ? '입고 일자' : target === 'ORDERED' ? '발주 확정 일자' : '전환 일자'}
              <span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="transitionDate"
              type="date"
              value={transitionDate}
              onChange={(e) => setTransitionDate(e.target.value)}
            />
          </div>

          {isStockIn && (
            <div className="space-y-1.5">
              <Label htmlFor="locationId">
                보관 위치<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Select value={locationId} onValueChange={setLocationId} disabled={loadingLocations}>
                <SelectTrigger id="locationId">
                  <SelectValue
                    placeholder={loadingLocations ? '불러오는 중...' : '위치를 선택하세요'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loadingLocations && locations.length === 0 && (
                <p className="text-xs text-destructive">
                  활성화된 보관 위치가 없습니다. 재고 설정에서 위치를 먼저 추가하세요.
                </p>
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
              saving || (isStockIn && (loadingLocations || locations.length === 0 || !locationId))
            }
          >
            {saving ? '처리 중...' : '확인'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
