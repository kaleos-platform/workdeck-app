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
  StockInAllocationFields,
  type StockInAllocationValue,
  type StockInRunItem,
  type StockInRunSet,
} from './stock-in-allocation-fields'

export type TransitionTarget = 'PLANNED' | 'ORDERED' | 'STOCKED_IN'

const STATUS_LABEL: Record<TransitionTarget, string> = {
  PLANNED: '계획중',
  ORDERED: '발주완료',
  STOCKED_IN: '입고완료',
}

type RunSummary = {
  id: string
  runNo: string
  totalQuantity: number
  itemCount: number
  items: StockInRunItem[]
  sets?: StockInRunSet[]
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
  const [saving, setSaving] = useState(false)
  const [alloc, setAlloc] = useState<StockInAllocationValue | null>(null)

  const isStockIn = target === 'STOCKED_IN'
  const isSetRun = isStockIn && (run?.sets?.length ?? 0) > 0

  // 다이얼로그 열릴 때 초기화
  useEffect(() => {
    if (!open) return
    setTransitionDate(todayYMD())
    setAlloc(null)
  }, [open])

  async function handleSubmit() {
    if (!run || !target) return
    if (!transitionDate) {
      toast.error('전환 일자를 입력하세요')
      return
    }
    if (isStockIn && !alloc?.valid) {
      toast.error(
        isSetRun ? '입고 위치를 선택하세요' : '입고 행의 위치와 수량(1개 이상)을 확인하세요'
      )
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        status: target,
        transitionDate,
        ...(isStockIn ? alloc?.payload : {}),
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
                  ? '계획중 상태로 되돌립니다. 발주완료 일자는 이력으로 유지됩니다.'
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
            <StockInAllocationFields
              run={run}
              active={open}
              onChange={setAlloc}
              disabled={saving}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={saving || (isStockIn && !alloc?.valid)}>
            {saving ? '처리 중...' : '확인'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
