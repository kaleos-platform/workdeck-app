'use client'

/**
 * 부채 관리 다이얼로그 — 목록 조회 + 추가/수정/삭제
 * API: GET/POST /api/finance/liabilities, PATCH/DELETE /api/finance/liabilities/[id]
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2 } from 'lucide-react'
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
import { formatWon } from '@/components/finance/format'

interface Liability {
  id: string
  name: string
  lender: string | null
  principal: number
  balance: number
  rate: string | null
  dueDate: string | null
  monthlyPayment: number | null
  memo?: string | null
}

interface LiabilityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 변경 후 대시보드 재조회 콜백 */
  onChanged: () => void
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
  }
}

export function LiabilityDialog({ open, onOpenChange, onChanged }: LiabilityDialogProps) {
  const [liabilities, setLiabilities] = useState<Liability[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  const loadLiabilities = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await fetch('/api/finance/liabilities')
      if (!res.ok) throw new Error('부채 조회 실패')
      const data = (await res.json()) as { liabilities: Liability[] }
      setLiabilities(data.liabilities)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      void loadLiabilities()
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm())
    }
  }, [open, loadLiabilities])

  function startAdd() {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(true)
  }

  function startEdit(l: Liability) {
    setEditingId(l.id)
    setForm({
      name: l.name,
      lender: l.lender ?? '',
      principal: String(l.principal),
      balance: String(l.balance),
      rate: l.rate ?? '',
      dueDate: l.dueDate ?? '',
      monthlyPayment: l.monthlyPayment !== null ? String(l.monthlyPayment) : '',
      memo: l.memo ?? '',
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

    // API는 principal/balance를 숫자 타입으로 검증 — 반드시 Number() 변환
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

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      principal,
      balance,
    }
    if (form.lender.trim()) payload.lender = form.lender.trim()
    if (form.rate.trim()) payload.rate = form.rate.trim()
    if (form.dueDate.trim()) payload.dueDate = form.dueDate.trim()
    if (form.monthlyPayment.trim() !== '') payload.monthlyPayment = Number(form.monthlyPayment)
    if (form.memo.trim()) payload.memo = form.memo.trim()

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
      cancelForm()
      await loadLiabilities()
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(l: Liability) {
    if (!confirm(`"${l.name}"을(를) 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/finance/liabilities/${l.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('부채가 삭제되었습니다')
      await loadLiabilities()
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>부채 관리</DialogTitle>
          <DialogDescription>대출·부채 항목을 추가, 수정, 삭제합니다.</DialogDescription>
        </DialogHeader>

        {/* 부채 목록 */}
        <div className="max-h-64 divide-y overflow-y-auto">
          {listLoading ? (
            <p className="py-4 text-sm text-muted-foreground">불러오는 중...</p>
          ) : liabilities.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">등록된 부채가 없습니다</p>
          ) : (
            liabilities.map((l) => (
              <div key={l.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{l.name}</span>
                    {l.lender && <span className="text-xs text-muted-foreground">{l.lender}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    원금 {formatWon(l.principal)} · 잔액{' '}
                    <span className="font-semibold text-red-600 dark:text-red-400">
                      {formatWon(l.balance)}
                    </span>
                    {l.rate && ` · ${l.rate}`}
                    {l.dueDate && ` · 만기 ${l.dueDate}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => startEdit(l)}
                    aria-label="수정"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDelete(l)}
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
            부채 추가
          </Button>
        )}

        {/* 추가/수정 폼 */}
        {showForm && (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
            <p className="text-sm font-medium">{editingId ? '부채 수정' : '새 부채 추가'}</p>

            <div className="grid grid-cols-2 gap-3">
              {/* 이름 */}
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">부채 이름 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
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
                  placeholder="예: 2028-06"
                  className="h-8 text-sm"
                />
              </div>

              {/* 월상환액 */}
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">월 상환액 (원)</Label>
                <Input
                  type="number"
                  value={form.monthlyPayment}
                  onChange={(e) => setForm((f) => ({ ...f, monthlyPayment: e.target.value }))}
                  placeholder="선택 입력"
                  className="h-8 text-sm"
                />
              </div>

              {/* 메모 */}
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">메모</Label>
                <Input
                  value={form.memo}
                  onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
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
