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
}

interface AccountFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = 추가, 레코드 = 수정 */
  account: Account | null
  /** 저장 성공 후 목록 재조회 콜백 */
  onSaved: () => void
}

function emptyForm() {
  return {
    name: '',
    holder: '',
    kind: 'BANK' as AccountKind,
    institution: '',
    accountNumber: '',
    accountType: '',
    openingBalance: '',
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
  }
}

export function AccountFormDialog({
  open,
  onOpenChange,
  account,
  onSaved,
}: AccountFormDialogProps) {
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const editingId = account?.id ?? null

  // 열릴 때 폼 초기화 — 수정이면 레코드 hydrate, 추가면 빈 폼
  useEffect(() => {
    if (open) {
      setForm(account ? toFormState(account) : emptyForm())
    }
  }, [open, account])

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('계좌 이름을 입력해 주세요')
      return
    }
    if (!form.institution.trim()) {
      toast.error('금융기관명을 입력해 주세요')
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
      toast.success(editingId ? '계좌가 수정되었습니다' : '계좌가 추가되었습니다')
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
          <DialogTitle>{editingId ? '계좌 수정' : '새 계좌 추가'}</DialogTitle>
          <DialogDescription>은행·카드 계좌 정보를 입력하세요.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {/* 계좌 이름 */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">계좌 이름 *</Label>
            <Input
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="예: 기업은행 사업용"
              className="h-8 text-sm"
            />
          </div>
          {/* 예금주 */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">예금주</Label>
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
          {/* 금융기관 */}
          <div className="space-y-1">
            <Label className="text-xs">금융기관 *</Label>
            <Input
              value={form.institution}
              onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="예: 기업은행"
              className="h-8 text-sm"
            />
          </div>
          {/* 계좌번호 */}
          <div className="space-y-1">
            <Label className="text-xs">계좌번호</Label>
            <Input
              value={form.accountNumber}
              onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="선택 입력"
              className="h-8 font-mono text-sm"
            />
          </div>
          {/* 계좌 유형 */}
          <div className="space-y-1">
            <Label className="text-xs">계좌 유형</Label>
            <Input
              value={form.accountType}
              onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value }))}
              onKeyDown={handleEnter}
              placeholder="예: 보통예금"
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
