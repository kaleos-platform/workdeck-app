'use client'

/**
 * 계좌 추가/수정 폼 다이얼로그 (폼 전용 — 목록은 balances-manager 카드에 유지)
 * API: POST /api/finance/accounts, PATCH /api/finance/accounts/[id]
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

type AccountKind = 'BANK' | 'CARD'

export interface Account {
  id: string
  name: string
  holder: string | null
  kind: AccountKind
  institution: string
  accountNumber: string | null
  accountType: string | null
  openingBalance: number | null
  currentBalance: number | null
  currentBalanceAsOf: string | null
}

interface AccountFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = 추가, 레코드 = 수정 */
  account: Account | null
  /** 추가 시 기본 종류 (카드 패널에서 열면 CARD) */
  defaultKind?: AccountKind
  /** 저장 성공 후 목록 재조회 콜백 */
  onSaved: () => void
}

function emptyForm(kind: AccountKind = 'BANK') {
  return {
    name: '',
    holder: '',
    kind,
    institution: '',
    accountNumber: '',
    accountType: '',
    openingBalance: '',
    currentBalance: '',
    currentBalanceAsOf: '',
  }
}

function toFormState(account: Account) {
  return {
    name: account.name,
    holder: account.holder ?? '',
    kind: account.kind,
    institution: account.institution,
    accountNumber: account.accountNumber ?? '',
    accountType: account.accountType ?? '',
    openingBalance: account.openingBalance !== null ? String(account.openingBalance) : '',
    currentBalance: account.currentBalance !== null ? String(account.currentBalance) : '',
    // ISO → 'YYYY-MM-DD' (date input용)
    currentBalanceAsOf: account.currentBalanceAsOf ? account.currentBalanceAsOf.slice(0, 10) : '',
  }
}

export function AccountFormDialog({
  open,
  onOpenChange,
  account,
  defaultKind = 'BANK',
  onSaved,
}: AccountFormDialogProps) {
  const [form, setForm] = useState(emptyForm(defaultKind))
  const [saving, setSaving] = useState(false)
  const editingId = account?.id ?? null
  const isCard = form.kind === 'CARD'

  // 열릴 때 폼 초기화 — 수정이면 레코드 hydrate, 추가면 빈 폼(패널 기본 종류)
  useEffect(() => {
    if (open) {
      setForm(account ? toFormState(account) : emptyForm(defaultKind))
    }
  }, [open, account, defaultKind])

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error(isCard ? '카드 이름을 입력해 주세요' : '계좌 이름을 입력해 주세요')
      return
    }
    if (!form.institution.trim()) {
      toast.error(isCard ? '카드사명을 입력해 주세요' : '금융기관명을 입력해 주세요')
      return
    }
    // 현재 잔액을 입력했으면 기준일도 함께 입력해야 한다.
    if (form.currentBalance.trim() !== '' && form.currentBalanceAsOf.trim() === '') {
      toast.error('현재 잔액의 기준일을 입력해 주세요')
      return
    }

    const payload = {
      name: form.name.trim(),
      holder: form.holder.trim() || null,
      kind: form.kind,
      institution: form.institution.trim(),
      accountNumber: form.accountNumber.trim() || undefined,
      accountType: form.accountType.trim() || undefined,
      ...(form.openingBalance.trim() !== '' && {
        openingBalance: Number(form.openingBalance),
      }),
      ...(form.currentBalance.trim() !== '' && {
        currentBalance: Number(form.currentBalance),
        currentBalanceAsOf: form.currentBalanceAsOf,
      }),
    }

    setSaving(true)
    try {
      const url = editingId ? `/api/finance/accounts/${editingId}` : '/api/finance/accounts'
      const method = editingId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success(
        editingId
          ? isCard
            ? '카드가 수정되었습니다'
            : '계좌가 수정되었습니다'
          : isCard
            ? '카드가 추가되었습니다'
            : '계좌가 추가되었습니다'
      )
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
          <DialogTitle>
            {editingId
              ? isCard
                ? '카드 수정'
                : '계좌 수정'
              : isCard
                ? '새 카드 추가'
                : '새 계좌 추가'}
          </DialogTitle>
          <DialogDescription>
            {isCard ? '카드 정보를 입력하세요.' : '은행 계좌 정보를 입력하세요.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {/* 이름 */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">{isCard ? '카드 이름' : '계좌 이름'} *</Label>
            <Input
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder={isCard ? '예: 하나카드 법인' : '예: 기업은행 사업용'}
              className="h-8 text-sm"
            />
          </div>
          {/* 예금주/명의자 */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">{isCard ? '명의자' : '예금주'}</Label>
            <Input
              value={form.holder}
              onChange={(e) => setForm((f) => ({ ...f, holder: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="예: 주식회사 워크덱"
              className="h-8 text-sm"
            />
          </div>
          {/* 종류 */}
          <div className="space-y-1">
            <Label className="text-xs">종류 *</Label>
            <Select
              value={form.kind}
              onValueChange={(v) => setForm((f) => ({ ...f, kind: v as AccountKind }))}
              disabled={!!editingId}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BANK">은행</SelectItem>
                <SelectItem value="CARD">카드</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* 금융기관/카드사 */}
          <div className="space-y-1">
            <Label className="text-xs">{isCard ? '카드사' : '금융기관'} *</Label>
            <Input
              value={form.institution}
              onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder={isCard ? '예: 하나카드' : '예: 기업은행'}
              className="h-8 text-sm"
            />
          </div>
          {/* 계좌/카드번호 */}
          <div className="space-y-1">
            <Label className="text-xs">{isCard ? '카드번호' : '계좌번호'}</Label>
            <Input
              value={form.accountNumber}
              onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="선택 입력"
              className="h-8 font-mono text-sm"
            />
          </div>
          {/* 유형 */}
          <div className="space-y-1">
            <Label className="text-xs">{isCard ? '카드 유형' : '계좌 유형'}</Label>
            <Input
              value={form.accountType}
              onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder={isCard ? '예: 법인카드' : '예: 보통예금'}
              className="h-8 text-sm"
            />
          </div>
          {/* 기초 잔액 */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">기초 잔액 (원)</Label>
            <Input
              type="number"
              value={form.openingBalance}
              onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="거래 이전 시작 잔액 (선택)"
              className="h-8 text-sm"
            />
          </div>

          {/* 현재 잔액 + 기준일 — 은행 거래 확정 시 자동 갱신되며, 여기서 수동 지정도 가능 */}
          <div className="space-y-1">
            <Label className="text-xs">현재 잔액 (원)</Label>
            <Input
              type="number"
              value={form.currentBalance}
              onChange={(e) => setForm((f) => ({ ...f, currentBalance: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="선택 입력"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">기준일</Label>
            <Input
              type="date"
              value={form.currentBalanceAsOf}
              onChange={(e) => setForm((f) => ({ ...f, currentBalanceAsOf: e.target.value }))}
              onKeyDown={handleEnter}
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
