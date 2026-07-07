'use client'

/**
 * 계좌 관리 페이지 메인 매니저
 * 상단 2패널: 자산(계좌) | 부채 (나란히)
 *   - 자산: 계좌 CRUD — GET/POST/PATCH/DELETE /api/finance/accounts
 *   - 부채: 부채 CRUD — GET/POST/PATCH/DELETE /api/finance/liabilities
 *           부채는 등록된 계좌를 "대출 계좌"로 연결 가능 → 자산 패널에 배지 표시
 * 하단: 자산·부채 계정과목 관리 (전체 폭) — GET/POST/PATCH/DELETE /api/finance/categories
 *
 * accounts·liabilities 상태는 부모가 보유하고 공유 reload로 갱신한다.
 * (부채 저장 시 계좌 목록의 "대출 계좌" 배지를 즉시 반영하기 위함)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, CreditCard, Landmark, Pencil, Plus, Trash2, Wallet, X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { formatPercent, formatWon } from '@/components/finance/format'
import { AccountFormDialog } from '@/components/finance/account-form-dialog'
import { LiabilityFormDialog } from '@/components/finance/liability-form-dialog'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type AccountKind = 'BANK' | 'CARD'

interface Account {
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
  accountId: string | null
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

// ─── 패널 A — 자산(계좌) ───────────────────────────────────────────────────────

interface AssetsPanelProps {
  accounts: Account[]
  loading: boolean
  /** 대출 연결된 계좌 id 집합 (배지 표시용) */
  linkedAccountIds: Set<string>
  /** 계좌·부채 목록 재조회 */
  onReload: () => Promise<void>
}

function AssetsPanel({ accounts, loading, linkedAccountIds, onReload }: AssetsPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)

  function startAdd() {
    setEditingAccount(null)
    setDialogOpen(true)
  }

  function startEdit(acct: Account) {
    setEditingAccount(acct)
    setDialogOpen(true)
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
      await onReload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold">자산 (계좌)</CardTitle>
            <CardDescription className="text-xs">은행·카드 계좌를 관리합니다</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={startAdd} className="shrink-0">
            <Plus className="mr-1 size-3.5" />
            계좌 추가
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 계좌 목록 */}
        {loading ? (
          <p className="text-xs text-muted-foreground">불러오는 중...</p>
        ) : accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">등록된 계좌가 없습니다</p>
        ) : (
          <div className="divide-y">
            {accounts.map((acct) => {
              const isLoan = linkedAccountIds.has(acct.id)
              return (
                <div key={acct.id} className="flex items-center gap-3 py-2.5">
                  {acct.kind === 'BANK' ? (
                    <Landmark className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
                  ) : (
                    <CreditCard className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
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
                      {isLoan && (
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-red-200 px-1.5 py-0 text-[10px] text-red-700 dark:border-red-800 dark:text-red-400">
                          <Wallet className="size-2.5" />
                          대출 계좌
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {acct.institution}
                      {acct.holder && ` · 예금주 ${acct.holder}`}
                      {acct.accountNumber && ` · ${acct.accountNumber}`}
                      {acct.openingBalance !== null && ` · 기초 ${formatWon(acct.openingBalance)}`}
                    </p>
                    {acct.currentBalance !== null && (
                      <p className="text-xs font-medium text-foreground">
                        잔액 {formatWon(acct.currentBalance)}
                        {acct.currentBalanceAsOf && (
                          <span className="ml-1 font-normal text-muted-foreground">
                            ({acct.currentBalanceAsOf.slice(0, 10)} 기준)
                          </span>
                        )}
                      </p>
                    )}
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
              )
            })}
          </div>
        )}

        <AccountFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          account={editingAccount}
          onSaved={onReload}
        />
      </CardContent>
    </Card>
  )
}

// ─── 패널 B — 부채 ────────────────────────────────────────────────────────────

interface LiabilitiesPanelProps {
  liabilities: Liability[]
  accounts: Account[]
  loading: boolean
  /** 계좌·부채 목록 재조회 */
  onReload: () => Promise<void>
}

function LiabilitiesPanel({ liabilities, accounts, loading, onReload }: LiabilitiesPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingLiability, setEditingLiability] = useState<Liability | null>(null)

  const accountNameById = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])
  const accountOptions = useMemo(
    () => accounts.map((a) => ({ id: a.id, name: a.name, institution: a.institution })),
    [accounts]
  )

  function startAdd() {
    setEditingLiability(null)
    setDialogOpen(true)
  }

  function startEdit(l: Liability) {
    setEditingLiability(l)
    setDialogOpen(true)
  }

  async function handleDelete(l: Liability) {
    if (!confirm(`"${l.name}"을(를) 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/finance/liabilities/${l.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('부채가 삭제되었습니다')
      await onReload()
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
          <Button variant="outline" size="sm" onClick={startAdd} className="shrink-0">
            <Plus className="mr-1 size-3.5" />
            부채 추가
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 부채 목록 */}
        {loading ? (
          <p className="text-xs text-muted-foreground">불러오는 중...</p>
        ) : liabilities.length === 0 ? (
          <p className="text-xs text-muted-foreground">등록된 부채가 없습니다</p>
        ) : (
          <div className="divide-y">
            {liabilities.map((l) => {
              const repaidRatio = l.principal > 0 ? (l.principal - l.balance) / l.principal : 0
              const progressPct = Math.min(100, Math.max(0, repaidRatio * 100))
              const isGood = repaidRatio >= 0.6
              const linkedName = l.accountId ? accountNameById.get(l.accountId) : undefined

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
                        {linkedName && ` · 대출계좌 ${linkedName}`}
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

        <LiabilityFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          liability={editingLiability}
          accounts={accountOptions}
          onSaved={onReload}
        />
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
  const [accounts, setAccounts] = useState<Account[]>([])
  const [liabilities, setLiabilities] = useState<Liability[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [liabilitiesLoading, setLiabilitiesLoading] = useState(false)

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true)
    try {
      const res = await fetch('/api/finance/accounts')
      if (!res.ok) throw new Error('계좌 조회 실패')
      const data = (await res.json()) as { accounts: Account[] }
      setAccounts(data.accounts)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setAccountsLoading(false)
    }
  }, [])

  const loadLiabilities = useCallback(async () => {
    setLiabilitiesLoading(true)
    try {
      const res = await fetch('/api/finance/liabilities')
      if (!res.ok) throw new Error('부채 조회 실패')
      const data = (await res.json()) as { liabilities: Liability[] }
      setLiabilities(data.liabilities)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLiabilitiesLoading(false)
    }
  }, [])

  // 계좌·부채는 서로 연결(대출 계좌)되어 있어 항상 함께 재조회한다.
  const reloadAll = useCallback(async () => {
    await Promise.all([loadAccounts(), loadLiabilities()])
  }, [loadAccounts, loadLiabilities])

  useEffect(() => {
    void reloadAll()
  }, [reloadAll])

  const linkedAccountIds = useMemo(
    () => new Set(liabilities.map((l) => l.accountId).filter((id): id is string => id !== null)),
    [liabilities]
  )

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AssetsPanel
          accounts={accounts}
          loading={accountsLoading}
          linkedAccountIds={linkedAccountIds}
          onReload={reloadAll}
        />
        <LiabilitiesPanel
          liabilities={liabilities}
          accounts={accounts}
          loading={liabilitiesLoading}
          onReload={reloadAll}
        />
      </div>
      <CategoriesSection />
    </div>
  )
}
