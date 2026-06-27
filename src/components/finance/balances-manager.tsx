'use client'

/**
 * 계좌 관리 페이지 메인 매니저
 * 섹션 A: 계좌(자산) CRUD — GET/POST/PATCH/DELETE /api/finance/accounts
 * 섹션 B: 부채 CRUD — GET/POST/PATCH/DELETE /api/finance/liabilities
 * 섹션 C: 자산·부채 계정과목 관리 — GET/POST/PATCH/DELETE /api/finance/categories
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, CreditCard, Landmark, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { formatPercent, formatWon } from '@/components/finance/format'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

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

interface Liability {
  id: string
  name: string
  lender: string | null
  principal: number
  balance: number
  rate: string | null
  dueDate: string | null
  monthlyPayment: number | null
  memo: string | null
}

interface CategoryNode {
  id: string
  parentId: string | null
  name: string
  type: string
  isSystem: boolean
  _count: { transactions: number }
  children: CategoryNode[]
}

// ─── 섹션 A — 계좌(자산) ───────────────────────────────────────────────────────

function emptyAccountForm() {
  return {
    name: '',
    kind: 'BANK' as AccountKind,
    institution: '',
    accountNumber: '',
    accountType: '',
    openingBalance: '',
  }
}

function AccountsSection() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyAccountForm())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/finance/accounts')
      if (!res.ok) throw new Error('계좌 조회 실패')
      const data = (await res.json()) as { accounts: Account[] }
      setAccounts(data.accounts)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function startAdd() {
    setEditingId(null)
    setForm(emptyAccountForm())
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
    setForm(emptyAccountForm())
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
      await load()
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
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold">계좌 (자산)</CardTitle>
            <CardDescription className="text-xs">은행·카드 계좌를 관리합니다</CardDescription>
          </div>
          {!showForm && (
            <Button variant="outline" size="sm" onClick={startAdd} className="shrink-0">
              <Plus className="mr-1 size-3.5" />
              계좌 추가
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 계좌 목록 */}
        {loading ? (
          <p className="text-xs text-muted-foreground">불러오는 중...</p>
        ) : accounts.length === 0 && !showForm ? (
          <p className="text-xs text-muted-foreground">등록된 계좌가 없습니다</p>
        ) : (
          <div className="divide-y">
            {accounts.map((acct) => (
              <div key={acct.id} className="flex items-center gap-3 py-2.5">
                {acct.kind === 'BANK' ? (
                  <Landmark className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
                ) : (
                  <CreditCard className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{acct.name}</span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full border px-1.5 py-0 text-[10px]',
                        acct.kind === 'BANK'
                          ? 'border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-400'
                          : 'border-amber-200 text-amber-700 dark:border-amber-800 dark:text-amber-400'
                      )}
                    >
                      {acct.kind === 'BANK' ? '은행' : '카드'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {acct.institution}
                    {acct.accountNumber && ` · ${acct.accountNumber}`}
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
            ))}
          </div>
        )}

        {/* 추가/수정 인라인 폼 */}
        {showForm && (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
            <p className="text-sm font-medium">{editingId ? '계좌 수정' : '새 계좌 추가'}</p>
            <div className="grid grid-cols-2 gap-3">
              {/* 계좌 이름 */}
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
      </CardContent>
    </Card>
  )
}

// ─── 섹션 B — 부채 ────────────────────────────────────────────────────────────

function emptyLiabilityForm() {
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

function LiabilitiesSection() {
  const [liabilities, setLiabilities] = useState<Liability[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyLiabilityForm())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/finance/liabilities')
      if (!res.ok) throw new Error('부채 조회 실패')
      const data = (await res.json()) as { liabilities: Liability[] }
      setLiabilities(data.liabilities)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function startAdd() {
    setEditingId(null)
    setForm(emptyLiabilityForm())
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
    setForm(emptyLiabilityForm())
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
      await load()
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
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold">부채</CardTitle>
            <CardDescription className="text-xs">대출·부채 항목을 관리합니다</CardDescription>
          </div>
          {!showForm && (
            <Button variant="outline" size="sm" onClick={startAdd} className="shrink-0">
              <Plus className="mr-1 size-3.5" />
              부채 추가
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 부채 목록 */}
        {loading ? (
          <p className="text-xs text-muted-foreground">불러오는 중...</p>
        ) : liabilities.length === 0 && !showForm ? (
          <p className="text-xs text-muted-foreground">등록된 부채가 없습니다</p>
        ) : (
          <div className="divide-y">
            {liabilities.map((l) => {
              const repaidRatio = l.principal > 0 ? (l.principal - l.balance) / l.principal : 0
              const progressPct = Math.min(100, Math.max(0, repaidRatio * 100))
              const isGood = repaidRatio >= 0.6

              return (
                <div key={l.id} className="py-3">
                  <div className="mb-2 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{l.name}</span>
                        {l.lender && (
                          <span className="text-xs text-muted-foreground">{l.lender}</span>
                        )}
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
                  {/* 상환율 진행바 */}
                  <Progress
                    value={Math.round(progressPct)}
                    className={cn(
                      'h-1.5',
                      isGood ? '[&>div]:bg-emerald-500' : '[&>div]:bg-amber-500'
                    )}
                  />
                  <p className="mt-0.5 text-right text-[10px] text-muted-foreground">
                    상환율 {formatPercent(progressPct)}
                  </p>
                </div>
              )
            })}
          </div>
        )}

        {/* 추가/수정 인라인 폼 */}
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
              {/* 월 상환액 */}
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
      </CardContent>
    </Card>
  )
}

// ─── 섹션 C — 자산·부채 계정과목 매핑 ────────────────────────────────────────────

function CategoriesSection() {
  const [assetRoot, setAssetRoot] = useState<CategoryNode | null>(null)
  const [liabilityRoot, setLiabilityRoot] = useState<CategoryNode | null>(null)
  const [loading, setLoading] = useState(false)
  // 이름 변경: editingId → 인라인 입력
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  // 추가: addingParentId → 새 항목 입력
  const [addingParentId, setAddingParentId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const addInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/finance/categories')
      if (!res.ok) throw new Error('계정과목 조회 실패')
      const data = (await res.json()) as { tree: CategoryNode[] }
      // 최상위 노드(parentId=null) 중 ASSET, LIABILITY 루트만 추출
      const roots = data.tree.filter((n) => n.parentId === null)
      setAssetRoot(roots.find((n) => n.type === 'ASSET') ?? null)
      setLiabilityRoot(roots.find((n) => n.type === 'LIABILITY') ?? null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function startRename(cat: CategoryNode) {
    setEditingId(cat.id)
    setEditingName(cat.name)
    setAddingParentId(null)
    setNewName('')
    // 다음 렌더링 후 포커스
    setTimeout(() => renameInputRef.current?.focus(), 0)
  }

  async function commitRename() {
    if (!editingId) return
    if (!editingName.trim()) {
      setEditingId(null)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/finance/categories/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingName.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(data?.message ?? '수정 실패')
      toast.success('이름이 수정되었습니다')
      setEditingId(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '수정 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteCategory(cat: CategoryNode) {
    if (!confirm(`"${cat.name}"을(를) 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/finance/categories/${cat.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('계정과목이 삭제되었습니다')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  async function handleAddCategory(parentId: string) {
    if (!newName.trim()) {
      toast.error('계정과목 이름을 입력해 주세요')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/finance/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, name: newName.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(data?.message ?? '추가 실패')
      toast.success('계정과목이 추가되었습니다')
      setAddingParentId(null)
      setNewName('')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '추가 실패')
    } finally {
      setSaving(false)
    }
  }

  function startAdd(rootId: string) {
    setAddingParentId(rootId)
    setNewName('')
    setEditingId(null)
    setTimeout(() => addInputRef.current?.focus(), 0)
  }

  function renderChildren(root: CategoryNode) {
    return (
      <div className="space-y-0.5">
        {root.children.map((child) => (
          <div
            key={child.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40"
          >
            {editingId === child.id ? (
              <>
                <Input
                  ref={renameInputRef}
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="h-6 text-xs"
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={commitRename}
                  disabled={saving}
                  aria-label="확인"
                >
                  <Check className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setEditingId(null)}
                  aria-label="취소"
                >
                  <X className="size-3" />
                </Button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 text-xs">{child.name}</span>
                {child._count.transactions > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {child._count.transactions}건
                  </span>
                )}
                {/* isSystem=false 항목만 편집/삭제 허용 */}
                {!child.isSystem && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => startRename(child)}
                      aria-label="이름 변경"
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleDeleteCategory(child)}
                      aria-label="삭제"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        ))}

        {/* 항목 추가 */}
        {addingParentId === root.id ? (
          <div className="flex items-center gap-2 px-2 py-1">
            <Input
              ref={addInputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAddCategory(root.id)
                if (e.key === 'Escape') {
                  setAddingParentId(null)
                  setNewName('')
                }
              }}
              placeholder="새 계정과목 이름"
              className="h-6 text-xs"
              autoFocus
            />
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => handleAddCategory(root.id)}
              disabled={saving}
              aria-label="추가 확인"
            >
              <Check className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                setAddingParentId(null)
                setNewName('')
              }}
              aria-label="추가 취소"
            >
              <X className="size-3" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => startAdd(root.id)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            <Plus className="size-3" />
            항목 추가
          </button>
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">자산·부채 계정과목</CardTitle>
        <CardDescription className="text-xs">
          자산·부채 거래의 회계 계정 매핑용 계정과목입니다. 항목을 추가·이름 변경·삭제할 수
          있습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-xs text-muted-foreground">불러오는 중...</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* 자산 계정 */}
            {assetRoot && (
              <div>
                <p className="mb-2 text-xs font-semibold text-blue-700 dark:text-blue-400">
                  {assetRoot.name}
                </p>
                {renderChildren(assetRoot)}
              </div>
            )}
            {/* 부채 계정 */}
            {liabilityRoot && (
              <div>
                <p className="mb-2 text-xs font-semibold text-red-700 dark:text-red-400">
                  {liabilityRoot.name}
                </p>
                {renderChildren(liabilityRoot)}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── 메인 내보내기 ─────────────────────────────────────────────────────────────

export function FinanceBalancesManager() {
  return (
    <div className="space-y-6">
      <AccountsSection />
      <LiabilitiesSection />
      <CategoriesSection />
    </div>
  )
}
