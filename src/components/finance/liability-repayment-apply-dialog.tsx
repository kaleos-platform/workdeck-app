'use client'

/**
 * 부채 상환 잔액 반영 다이얼로그
 * 감지된 미반영 상환을 원클릭으로 잔액에 확정한다.
 * API: PATCH /api/finance/liabilities/[id]  { balance, balanceAsOf }
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatWon } from '@/components/finance/format'

export interface RepaymentApplyTarget {
  id: string
  name: string
  balance: number
  pending: {
    count: number
    sum: number
    throughDate: string | null
  }
}

interface LiabilityRepaymentApplyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  liability: RepaymentApplyTarget | null
  /** 저장 성공 후 부모가 재조회하는 콜백 */
  onSaved: () => void
}

export function LiabilityRepaymentApplyDialog({
  open,
  onOpenChange,
  liability,
  onSaved,
}: LiabilityRepaymentApplyDialogProps) {
  // 반영 후 잔액 (기본값: balance - pending.sum)
  const [newBalance, setNewBalance] = useState('')
  const [saving, setSaving] = useState(false)

  // 열릴 때 기본값 세팅
  useEffect(() => {
    if (open && liability) {
      const suggested = Math.max(0, liability.balance - liability.pending.sum)
      setNewBalance(String(suggested))
    }
  }, [open, liability])

  if (!liability) return null

  async function handleConfirm() {
    if (!liability) return
    const parsed = Number(newBalance)
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error('잔액이 올바르지 않습니다')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/finance/liabilities/${liability.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          balance: parsed,
          balanceAsOf: liability.pending.throughDate ?? null,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(data?.message ?? '잔액 반영 실패')
      toast.success('잔액이 반영되었습니다')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '잔액 반영 실패')
    } finally {
      setSaving(false)
    }
  }

  const suggestedBalance = Math.max(0, liability.balance - liability.pending.sum)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>잔액 반영</DialogTitle>
          <DialogDescription>{liability.name} — 감지된 상환을 잔액에 확정합니다.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* 현재 잔액 / 감지 상환 요약 */}
          <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">현재 잔액</span>
              <span className="font-mono font-semibold text-red-600 dark:text-red-400">
                {formatWon(liability.balance)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                감지된 상환 ({liability.pending.count}건)
              </span>
              <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                -{formatWon(liability.pending.sum)}
              </span>
            </div>
            <div className="border-t pt-1.5 flex justify-between">
              <span className="text-muted-foreground">제안 잔액</span>
              <span className="font-mono font-semibold">{formatWon(suggestedBalance)}</span>
            </div>
          </div>

          {/* 반영 후 잔액 입력 (수정 가능) */}
          <div className="space-y-1">
            <Label className="text-xs">반영 후 잔액 (원)</Label>
            <Input
              type="number"
              value={newBalance}
              onChange={(e) => setNewBalance(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleConfirm()
              }}
              min={0}
              className="h-8 text-sm font-mono"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              명세서의 실제 잔액으로 조정하세요. 이자가 포함된 상환이면 원금 감소분과 차이가 있을 수
              있습니다.
            </p>
          </div>

          {/* 반영 기준일 안내 */}
          {liability.pending.throughDate && (
            <p className="text-[11px] text-muted-foreground">
              기준일: {liability.pending.throughDate.slice(0, 10)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={saving}>
            {saving ? '반영 중...' : '잔액 반영'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
