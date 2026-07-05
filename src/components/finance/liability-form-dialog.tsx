'use client'

/**
 * 부채 추가/수정 폼 다이얼로그 (폼 전용 — 목록은 balances-manager 카드에 유지)
 * API: POST /api/finance/liabilities, PATCH /api/finance/liabilities/[id]
 */
import { useEffect, useState, type KeyboardEvent } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Radix SelectItem은 빈 문자열 value를 허용하지 않으므로 "연결 안 함"에 센티넬 사용
const NO_ACCOUNT = '__none__'

export interface Liability {
  id: string
  name: string
  lender: string | null
  principal: number
  balance: number
  rate: string | null
  dueDate: string | null
  monthlyPayment: number | null
  memo: string | null
  accountId: string | null
}

/** 부채 폼의 계좌 선택용 최소 계좌 정보 */
export interface LiabilityAccountOption {
  id: string
  name: string
  institution: string
}

interface LiabilityFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = 추가, 레코드 = 수정 */
  liability: Liability | null
  /** 대출 계좌로 지정 가능한 계좌 목록 (부모가 보유) */
  accounts: LiabilityAccountOption[]
  /** 저장 성공 후 목록 재조회 콜백 */
  onSaved: () => void
}

function emptyForm() {
  return {
    name: '',
    lender: '',
    principal: '',
    balance: '',
    rate: '',
    dueDate: '',
    monthlyPayment: '',
    memo: '',
    accountId: NO_ACCOUNT,
  }
}

function toFormState(l: Liability) {
  return {
    name: l.name,
    lender: l.lender ?? '',
    principal: String(l.principal),
    balance: String(l.balance),
    rate: l.rate ?? '',
    dueDate: l.dueDate ?? '',
    monthlyPayment: l.monthlyPayment !== null ? String(l.monthlyPayment) : '',
    memo: l.memo ?? '',
    accountId: l.accountId ?? NO_ACCOUNT,
  }
}

export function LiabilityFormDialog({
  open,
  onOpenChange,
  liability,
  accounts,
  onSaved,
}: LiabilityFormDialogProps) {
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const editingId = liability?.id ?? null

  // 열릴 때 폼 초기화 — 수정이면 레코드 hydrate, 추가면 빈 폼
  useEffect(() => {
    if (open) {
      setForm(liability ? toFormState(liability) : emptyForm())
    }
  }, [open, liability])

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('부채 이름을 입력해 주세요')
      return
    }
    if (form.principal.trim() === '') {
      toast.error('원금을 입력해 주세요')
      return
    }
    if (form.balance.trim() === '') {
      toast.error('잔액을 입력해 주세요')
      return
    }

    const principal = Number(form.principal)
    const balance = Number(form.balance)
    if (!Number.isFinite(principal) || principal < 0) {
      toast.error('원금이 올바르지 않습니다')
      return
    }
    if (!Number.isFinite(balance) || balance < 0) {
      toast.error('잔액이 올바르지 않습니다')
      return
    }

    const payload: Record<string, unknown> = { name: form.name.trim(), principal, balance }
    if (form.lender.trim()) payload.lender = form.lender.trim()
    if (form.rate.trim()) payload.rate = form.rate.trim()
    if (form.dueDate.trim()) payload.dueDate = form.dueDate.trim()
    if (form.monthlyPayment.trim() !== '') payload.monthlyPayment = Number(form.monthlyPayment)
    if (form.memo.trim()) payload.memo = form.memo.trim()
    // 연결 계좌 — 항상 전송(수정 시 연결 해제 반영). 센티넬은 null로 변환.
    payload.accountId = form.accountId === NO_ACCOUNT ? null : form.accountId

    setSaving(true)
    try {
      const url = editingId ? `/api/finance/liabilities/${editingId}` : '/api/finance/liabilities'
      const method = editingId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success(editingId ? '부채가 수정되었습니다' : '부채가 추가되었습니다')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  function handleEnter(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSave()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingId ? '부채 수정' : '새 부채 추가'}</DialogTitle>
          <DialogDescription>대출·부채 정보를 입력하세요.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {/* 이름 */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">부채 이름 *</Label>
            <Input
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="예: 기업은행 사업자대출"
              className="h-8 text-sm"
            />
          </div>
          {/* 채권자 */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">채권자 (금융기관)</Label>
            <Input
              value={form.lender}
              onChange={(e) => setForm((f) => ({ ...f, lender: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="예: 기업은행"
              className="h-8 text-sm"
            />
          </div>
          {/* 원금 */}
          <div className="space-y-1">
            <Label className="text-xs">원금 (원) *</Label>
            <Input
              type="number"
              value={form.principal}
              onChange={(e) => setForm((f) => ({ ...f, principal: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="100000000"
              className="h-8 text-sm"
            />
          </div>
          {/* 잔액 */}
          <div className="space-y-1">
            <Label className="text-xs">현재 잔액 (원) *</Label>
            <Input
              type="number"
              value={form.balance}
              onChange={(e) => setForm((f) => ({ ...f, balance: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="80000000"
              className="h-8 text-sm"
            />
          </div>
          {/* 이율 */}
          <div className="space-y-1">
            <Label className="text-xs">이율</Label>
            <Input
              value={form.rate}
              onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="예: 연 4.5%"
              className="h-8 text-sm"
            />
          </div>
          {/* 만기일 */}
          <div className="space-y-1">
            <Label className="text-xs">만기일</Label>
            <Input
              value={form.dueDate}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="예: 2028-06"
              className="h-8 text-sm"
            />
          </div>
          {/* 월 상환액 */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">월 상환액 (원)</Label>
            <Input
              type="number"
              value={form.monthlyPayment}
              onChange={(e) => setForm((f) => ({ ...f, monthlyPayment: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="선택 입력"
              className="h-8 text-sm"
            />
          </div>
          {/* 연결 계좌 (대출 계좌 지정) */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">연결 계좌 (대출 계좌 지정)</Label>
            <Select
              value={form.accountId}
              onValueChange={(v) => setForm((f) => ({ ...f, accountId: v }))}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="연결 안 함" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ACCOUNT}>연결 안 함</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {a.institution}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              계좌를 선택하면 계좌 목록에 &lsquo;대출 계좌&rsquo; 표시가 붙습니다.
            </p>
          </div>
          {/* 메모 */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">메모</Label>
            <Input
              value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="선택 입력"
              className="h-8 text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : editingId ? '수정' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
