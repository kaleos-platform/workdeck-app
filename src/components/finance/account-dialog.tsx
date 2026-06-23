'use client'

/**
 * 계좌 관리 다이얼로그 — 목록 조회 + 추가/수정/삭제
 * API: GET/POST /api/finance/accounts, PATCH/DELETE /api/finance/accounts/[id]
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Landmark, CreditCard } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { formatWon, maskAccountNumber } from '@/components/finance/format'

type AccountKind = 'BANK' | 'CARD'

interface Account {
  id: string
  name: string
  kind: AccountKind
  institution: string
  accountNumber: string | null
  accountType: string | null
  openingBalance: number | null
}

interface AccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 변경 후 대시보드 재조회 콜백 */
  onChanged: () => void
}

// ─── 빈 폼 ───────────────────────────────────────────────────────────────────

function emptyForm() {
  return {
    name: '',
    kind: 'BANK' as AccountKind,
    institution: '',
    accountNumber: '',
    accountType: '',
    openingBalance: '',
  }
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function AccountDialog({ open, onOpenChange, onChanged }: AccountDialogProps) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  const loadAccounts = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await fetch('/api/finance/accounts')
      if (!res.ok) throw new Error('계좌 조회 실패')
      const data = (await res.json()) as { accounts: Account[] }
      setAccounts(data.accounts)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      void loadAccounts()
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm())
    }
  }, [open, loadAccounts])

  function startAdd() {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(true)
  }

  function startEdit(acct: Account) {
    setEditingId(acct.id)
    setForm({
      name: acct.name,
      kind: acct.kind,
      institution: acct.institution,
      accountNumber: acct.accountNumber ?? '',
      accountType: acct.accountType ?? '',
      openingBalance: acct.openingBalance !== null ? String(acct.openingBalance) : '',
    })
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm())
  }

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
      kind: form.kind,
      institution: form.institution.trim(),
      accountNumber: form.accountNumber.trim() || undefined,
      accountType: form.accountType.trim() || undefined,
      // API는 숫자 타입 검증 없음(openingBalance는 optional) — 빈 문자열 제외
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
      cancelForm()
      await loadAccounts()
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(acct: Account) {
    if (!confirm(`"${acct.name}" 계좌를 삭제하시겠습니까?\n연결된 거래 내역도 함께 삭제됩니다.`))
      return
    try {
      const res = await fetch(`/api/finance/accounts/${acct.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => ({}))) as {
        message?: string
        deletedTransactions?: number
      }
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      const cnt = data.deletedTransactions ?? 0
      toast.success(`계좌가 삭제되었습니다${cnt > 0 ? ` (거래 ${cnt}건 포함)` : ''}`)
      await loadAccounts()
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>계좌 관리</DialogTitle>
          <DialogDescription>은행·카드 계좌를 추가, 수정, 삭제합니다.</DialogDescription>
        </DialogHeader>

        {/* 계좌 목록 */}
        <div className="max-h-64 divide-y overflow-y-auto">
          {listLoading ? (
            <p className="py-4 text-sm text-muted-foreground">불러오는 중...</p>
          ) : accounts.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">등록된 계좌가 없습니다</p>
          ) : (
            accounts.map((acct) => (
              <div key={acct.id} className="flex items-center gap-3 py-2.5">
                {acct.kind === 'BANK' ? (
                  <Landmark className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
                ) : (
                  <CreditCard className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{acct.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {acct.institution}
                    {acct.accountNumber && ` · ${maskAccountNumber(acct.accountNumber)}`}
                    {acct.openingBalance !== null && ` · 기초 ${formatWon(acct.openingBalance)}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => startEdit(acct)}
                    aria-label="수정"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDelete(acct)}
                    aria-label="삭제"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 추가 버튼 */}
        {!showForm && (
          <Button variant="outline" size="sm" onClick={startAdd} className="w-full">
            <Plus className="mr-1 size-3.5" />
            계좌 추가
          </Button>
        )}

        {/* 추가/수정 폼 */}
        {showForm && (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
            <p className="text-sm font-medium">{editingId ? '계좌 수정' : '새 계좌 추가'}</p>

            <div className="grid grid-cols-2 gap-3">
              {/* 이름 */}
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">계좌 이름 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="예: 기업은행 사업용"
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
                  placeholder="선택 입력"
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={cancelForm}>
                취소
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? '저장 중...' : editingId ? '수정' : '추가'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
