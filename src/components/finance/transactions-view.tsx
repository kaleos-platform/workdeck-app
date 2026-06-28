'use client'

/**
 * 재무 관리 Deck — P5 거래 내역(확인·처리) 뷰
 * 탭 1: 확인·처리(스테이징 DRAFT 행)
 * 탭 2: 전체 거래(확정 FinTransaction)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2, Sparkles, Tag } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FloatingActionBar, floatingActionButtonClass } from '@/components/ui/floating-action-bar'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { classStatusBadge, accountKindLabel, formatWon } from '@/components/finance/format'
import { CategoryCombobox } from '@/components/finance/category-combobox'
import {
  buildClassifyOptions,
  buildParentOptions,
  type ComboOption,
} from '@/lib/finance/category-options'
import type { FinAccountKind, FinClassStatus, FinStagedResolution } from '@/generated/prisma/enums'

// ─── 타입 정의 ───────────────────────────────────────────────────────────────

type CategoryNode = {
  id: string
  parentId: string | null
  name: string
  type: string
  isActive: boolean
  children: CategoryNode[]
}

type StagedRow = {
  id: string
  importId: string
  accountId: string
  txnDate: string
  direction: 'IN' | 'OUT'
  amount: number
  balanceAfter: number | null
  description: string | null
  counterparty: string | null
  approvalNo: string | null
  cancelFlag: boolean
  classStatus: FinClassStatus
  resolution: FinStagedResolution
  matchedRuleId: string | null
  categoryId: string | null
  category: { id: string; name: string; parent: { name: string } | null } | null
  account: { id: string; name: string; kind: FinAccountKind }
  /** 미분류 행의 룰(키워드) 추천 — 서버가 배치 계산. 매칭 없으면 null. 버튼 없이 자동 표시. */
  ruleSuggestion: { categoryId: string; categoryName: string; reason: string } | null
}

type StagedCounts = {
  total: number
  unclassified: number
  review: number
  dup: number
  classified: number
}

type Transaction = {
  id: string
  accountId: string
  txnDate: string
  direction: 'IN' | 'OUT'
  amount: number
  balanceAfter: number | null
  description: string | null
  counterparty: string | null
  approvalNo: string | null
  cancelFlag: boolean
  isTransfer: boolean
  classStatus: FinClassStatus
  matchedRuleId: string | null
  categoryId: string | null
  category: { id: string; name: string; type: string; parent: { name: string } | null } | null
  account: { id: string; name: string; kind: FinAccountKind }
}

type TransactionSummary = {
  incomeTotal: number
  expenseTotal: number
  net: number
}

// ─── 날짜 포맷 ───────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export function TransactionsView() {
  const searchParams = useSearchParams()
  const importIdParam = searchParams.get('importId') ?? undefined

  // 카테고리 트리 + 잎 목록
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([])
  const leafTargets = useMemo(() => buildClassifyOptions(categoryTree), [categoryTree])

  // 계좌 목록 (전체 거래 출처 필터)
  const [accounts, setAccounts] = useState<{ id: string; name: string; kind: FinAccountKind }[]>([])

  // 스테이징 상태
  const [stagingRows, setStagingRows] = useState<StagedRow[]>([])
  const [stagingCounts, setStagingCounts] = useState<StagedCounts>({
    total: 0,
    unclassified: 0,
    review: 0,
    dup: 0,
    classified: 0,
  })
  const [stagingTab, setStagingTab] = useState<string>('all')
  const [stagingLoading, setStagingLoading] = useState(true)

  // 확정 거래 상태
  const [txnRows, setTxnRows] = useState<Transaction[]>([])
  const [txnTotal, setTxnTotal] = useState(0)
  const [txnSummary, setTxnSummary] = useState<TransactionSummary>({
    incomeTotal: 0,
    expenseTotal: 0,
    net: 0,
  })
  const [txnLoading, setTxnLoading] = useState(false)

  // 필터 (전체 거래) — 'all'은 파라미터 미포함 센티넬
  const [filterQ, setFilterQ] = useState('')
  const [filterAccountId, setFilterAccountId] = useState('')
  const [filterDirection, setFilterDirection] = useState<'all' | 'IN' | 'OUT'>('all')
  const [filterClassStatus, setFilterClassStatus] = useState<
    'all' | 'CLASSIFIED' | 'REVIEW' | 'UNCLASSIFIED'
  >('all')

  // 메인 탭 — 초기값은 로드 후 결정
  const [mainTab, setMainTab] = useState<'staging' | 'transactions'>('staging')
  const [mainTabReady, setMainTabReady] = useState(false)

  // 커밋 다이얼로그
  const [commitDialogOpen, setCommitDialogOpen] = useState(false)
  const [committing, setCommitting] = useState(false)

  // 분류 직후 동일 적요 자동 적용 다이얼로그
  const [autoApply, setAutoApply] = useState<{ categoryId: string; siblingIds: string[] } | null>(
    null
  )

  // 카테고리 트리 로드 — 실패는 토스트로 가시화(빈 드롭다운 미스터리 방지)
  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/finance/categories')
      if (!res.ok) {
        toast.error('계정과목을 불러오지 못했습니다. 새로고침 해주세요')
        return
      }
      const data = await res.json()
      setCategoryTree(data.tree ?? [])
    } catch {
      toast.error('계정과목을 불러오지 못했습니다. 새로고침 해주세요')
    }
  }, [])

  // 계좌 목록 로드 (출처 필터 옵션)
  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/finance/accounts')
      if (!res.ok) return
      const data = await res.json()
      setAccounts(
        (data.accounts ?? []).map((a: { id: string; name: string; kind: FinAccountKind }) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
        }))
      )
    } catch {
      // 조용히 실패
    }
  }, [])

  // 스테이징 조회
  const loadStaging = useCallback(
    async (tab: string = 'all') => {
      setStagingLoading(true)
      try {
        const params = new URLSearchParams({ tab })
        if (importIdParam) params.set('importId', importIdParam)
        const res = await fetch(`/api/finance/staging?${params}`)
        if (!res.ok) throw new Error('스테이징 조회 실패')
        const data = await res.json()
        setStagingRows(data.rows ?? [])
        setStagingCounts(
          data.counts ?? { total: 0, unclassified: 0, review: 0, dup: 0, classified: 0 }
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '스테이징 조회 실패')
      } finally {
        setStagingLoading(false)
      }
    },
    [importIdParam]
  )

  // 확정 거래 조회
  const loadTransactions = useCallback(async () => {
    setTxnLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterQ) params.set('q', filterQ)
      if (filterAccountId) params.set('accountId', filterAccountId)
      if (filterDirection !== 'all') params.set('direction', filterDirection)
      if (filterClassStatus !== 'all') params.set('classStatus', filterClassStatus)
      const res = await fetch(`/api/finance/transactions?${params}`)
      if (!res.ok) throw new Error('거래 내역 조회 실패')
      const data = await res.json()
      setTxnRows(data.rows ?? [])
      setTxnTotal(data.total ?? 0)
      setTxnSummary(data.summary ?? { incomeTotal: 0, expenseTotal: 0, net: 0 })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '거래 내역 조회 실패')
    } finally {
      setTxnLoading(false)
    }
  }, [filterQ, filterAccountId, filterDirection, filterClassStatus])

  // 초기 로드
  useEffect(() => {
    void loadCategories()
    void loadAccounts()
    void loadStaging('all').then(() => {
      // counts 반영 후 탭 결정
      setMainTabReady(true)
    })
  }, [loadCategories, loadAccounts, loadStaging])

  // counts 변화에 따른 기본 탭 결정 (초기 1회)
  useEffect(() => {
    if (!mainTabReady) return
    setMainTab(stagingCounts.total > 0 ? 'staging' : 'transactions')
  }, [mainTabReady, stagingCounts.total])

  // 전체 거래 탭 전환 시 조회
  useEffect(() => {
    if (mainTab === 'transactions') {
      void loadTransactions()
    }
  }, [mainTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // 스테이징 하위 탭 변경
  const handleStagingTabChange = (tab: string) => {
    setStagingTab(tab)
    void loadStaging(tab)
  }

  // 스테이징 categoryId 변경 → PATCH
  const handleStagingClassify = async (rowId: string, categoryId: string) => {
    try {
      const res = await fetch(`/api/finance/staging/${rowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '분류 저장 실패')
      void loadStaging(stagingTab)
      // 동일 적요+동일 방향 미처리 행이 있으면 자동 적용 여부를 물음
      const siblingIds: string[] = Array.isArray(data?.siblingIds) ? data.siblingIds : []
      if (siblingIds.length > 0) setAutoApply({ categoryId, siblingIds })
      else toast.success('동일 적요는 다음부터 자동 분류됩니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '분류 저장 실패')
    }
  }

  // 일괄 처리(bulk 엔드포인트) — 계정과목 분류 또는 중복 처리
  const applyBulk = useCallback(
    async (payload: { ids: string[]; categoryId?: string; resolution?: FinStagedResolution }) => {
      const res = await fetch('/api/finance/staging/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '일괄 처리 실패')
      return (data?.updated as number) ?? 0
    },
    []
  )

  const handleBulkClassify = async (ids: string[], categoryId: string) => {
    try {
      const n = await applyBulk({ ids, categoryId })
      toast.success(`${n}건에 계정과목을 적용했습니다`)
      void loadStaging(stagingTab)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '일괄 처리 실패')
    }
  }

  const handleBulkResolution = async (ids: string[], resolution: FinStagedResolution) => {
    try {
      const n = await applyBulk({ ids, resolution })
      toast.success(resolution === 'DUP_SAME' ? `${n}건 제외 처리` : `${n}건 유지 처리`)
      void loadStaging(stagingTab)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '일괄 처리 실패')
    }
  }

  const handleAutoApplyConfirm = async () => {
    if (!autoApply) return
    try {
      const n = await applyBulk({ ids: autoApply.siblingIds, categoryId: autoApply.categoryId })
      toast.success(`동일 적요 ${n}건에 적용했습니다`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '일괄 적용 실패')
    } finally {
      setAutoApply(null)
      void loadStaging(stagingTab)
    }
  }

  // 중복 처리: 유지 → NEW, 제외 → DUP_SAME
  const handleDupResolution = async (rowId: string, resolution: FinStagedResolution) => {
    try {
      const res = await fetch(`/api/finance/staging/${rowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution }),
      })
      if (!res.ok) throw new Error('처리 저장 실패')
      toast.success(resolution === 'DUP_SAME' ? '제외 처리되었습니다' : '유지로 변경되었습니다')
      void loadStaging(stagingTab)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '처리 저장 실패')
    }
  }

  // 저장 처리 — 분류완료(CLASSIFIED) 행만 확정 저장(임포트 무관). 미분류·검토는 보류.
  const classifiedCount = stagingCounts.classified
  const heldBack = stagingCounts.unclassified + stagingCounts.review

  const handleCommit = async () => {
    setCommitting(true)
    try {
      const res = await fetch('/api/finance/staging/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // importId 있으면(업로드 후 진입) 그 임포트로 한정, 없으면(네비 진입) 전체 분류완료.
        // 어느 쪽이든 분류완료 행만 저장 — 표시된 카운트와 일치.
        body: JSON.stringify(importIdParam ? { importId: importIdParam } : {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '저장 처리 실패')
      toast.success(`분류완료 ${data.committed}건을 저장했습니다`)
      setCommitDialogOpen(false)
      void loadStaging(stagingTab) // 잔여(미분류·검토) 갱신
      // 전체 거래 탭으로 전환
      setMainTab('transactions')
      void loadTransactions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 처리 실패')
    } finally {
      setCommitting(false)
    }
  }

  // 확정 거래 categoryId 변경 → PATCH
  const handleTxnClassify = async (txnId: string, categoryId: string) => {
    try {
      const res = await fetch(`/api/finance/transactions/${txnId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId }),
      })
      if (!res.ok) throw new Error('분류 저장 실패')
      toast.success('계정과목이 변경되었습니다')
      void loadTransactions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '분류 저장 실패')
    }
  }

  // 확정 거래 일괄 처리(bulk 엔드포인트) — 계정과목 분류 / 삭제
  const handleTxnBulkClassify = useCallback(
    async (ids: string[], categoryId: string) => {
      try {
        const res = await fetch('/api/finance/transactions/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, categoryId }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.message ?? '일괄 처리 실패')
        toast.success(`${data.updated ?? 0}건에 계정과목을 적용했습니다`)
        void loadTransactions()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '일괄 처리 실패')
      }
    },
    [loadTransactions]
  )

  const handleTxnBulkDelete = useCallback(
    async (ids: string[]) => {
      try {
        const res = await fetch('/api/finance/transactions/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, action: 'delete' }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
        toast.success(`${data.deleted ?? 0}건을 삭제했습니다`)
        void loadTransactions()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '삭제 실패')
      }
    },
    [loadTransactions]
  )

  // 필터 검색 실행
  const handleTxnSearch = useCallback(() => {
    void loadTransactions()
  }, [loadTransactions])

  return (
    <Tabs
      value={mainTab}
      onValueChange={(v) => setMainTab(v as 'staging' | 'transactions')}
      className="space-y-4"
    >
      <TabsList>
        <TabsTrigger value="staging">
          확인·처리
          {stagingCounts.total > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-xs">
              {stagingCounts.total}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="transactions">전체 거래</TabsTrigger>
      </TabsList>

      {/* ── 확인·처리(스테이징) ── */}
      <TabsContent value="staging" className="space-y-3">
        <StagingPanel
          rows={stagingRows}
          counts={stagingCounts}
          loading={stagingLoading}
          tab={stagingTab}
          leafTargets={leafTargets}
          categoryTree={categoryTree}
          reloadCategories={loadCategories}
          classifiedCount={classifiedCount}
          heldBack={heldBack}
          onTabChange={handleStagingTabChange}
          onClassify={handleStagingClassify}
          onDupResolution={handleDupResolution}
          onBulkClassify={handleBulkClassify}
          onBulkResolution={handleBulkResolution}
          onCommitRequest={() => setCommitDialogOpen(true)}
        />
      </TabsContent>

      {/* ── 전체 거래(확정 내역) ── */}
      <TabsContent value="transactions" className="space-y-3">
        <TransactionsPanel
          rows={txnRows}
          total={txnTotal}
          summary={txnSummary}
          loading={txnLoading}
          filterQ={filterQ}
          filterAccountId={filterAccountId}
          filterDirection={filterDirection}
          filterClassStatus={filterClassStatus}
          accounts={accounts}
          leafTargets={leafTargets}
          categoryTree={categoryTree}
          reloadCategories={loadCategories}
          onFilterQChange={setFilterQ}
          onFilterAccountIdChange={setFilterAccountId}
          onFilterDirectionChange={setFilterDirection}
          onFilterClassStatusChange={setFilterClassStatus}
          onSearch={handleTxnSearch}
          onClassify={handleTxnClassify}
          onBulkClassify={handleTxnBulkClassify}
          onBulkDelete={handleTxnBulkDelete}
        />
      </TabsContent>

      {/* ── 커밋 확인 다이얼로그 ── */}
      <Dialog open={commitDialogOpen} onOpenChange={setCommitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>저장 처리 확인</DialogTitle>
            <DialogDescription>
              분류완료 건만 확정 거래로 저장합니다. 미분류·검토 행은 보류됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">분류완료 저장</span>
              <span className="font-mono font-medium">{classifiedCount}건</span>
            </div>
            {heldBack > 0 && (
              <div className="flex justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950">
                <span className="text-amber-700 dark:text-amber-400">보류(미분류·검토)</span>
                <span className="font-mono font-medium text-amber-700 dark:text-amber-400">
                  {heldBack}건
                </span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCommitDialogOpen(false)}
              disabled={committing}
            >
              취소
            </Button>
            <Button onClick={handleCommit} disabled={committing}>
              {committing ? '처리 중...' : '저장 처리'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 동일 적요 자동 적용 확인 ── */}
      <Dialog open={autoApply !== null} onOpenChange={(open) => !open && setAutoApply(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>동일 적요 자동 적용</DialogTitle>
            <DialogDescription>
              같은 적요·같은 방향의 미처리 내역{' '}
              <strong>{autoApply?.siblingIds.length ?? 0}건</strong>에도 같은 계정과목을 적용할까요?
              (검토 제안도 덮어씁니다.)
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutoApply(null)}>
              이 건만
            </Button>
            <Button onClick={handleAutoApplyConfirm}>
              {autoApply?.siblingIds.length ?? 0}건에 적용
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  )
}

// ─── 확인·처리 패널 ──────────────────────────────────────────────────────────

function StagingPanel({
  rows,
  counts,
  loading,
  tab,
  leafTargets,
  categoryTree,
  reloadCategories,
  classifiedCount,
  heldBack,
  onTabChange,
  onClassify,
  onDupResolution,
  onBulkClassify,
  onBulkResolution,
  onCommitRequest,
}: {
  rows: StagedRow[]
  counts: StagedCounts
  loading: boolean
  tab: string
  leafTargets: ComboOption[]
  categoryTree: CategoryNode[]
  reloadCategories: () => Promise<void>
  classifiedCount: number
  heldBack: number
  onTabChange: (tab: string) => void
  onClassify: (rowId: string, categoryId: string) => void
  onDupResolution: (rowId: string, resolution: FinStagedResolution) => void
  onBulkClassify: (ids: string[], categoryId: string) => Promise<void>
  onBulkResolution: (ids: string[], resolution: FinStagedResolution) => Promise<void>
  onCommitRequest: () => void
}) {
  const hasDraft = counts.total > 0

  // 다중 선택 상태. selectedInView가 현재 탭의 행으로 스코프하므로 탭 전환 시 자연히 정리된다.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const rowIds = rows.map((r) => r.id)
  const selectedInView = rowIds.filter((id) => selectedIds.has(id))
  const allSelected = rowIds.length > 0 && selectedInView.length === rowIds.length
  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) rowIds.forEach((id) => next.delete(id))
      else rowIds.forEach((id) => next.add(id))
      return next
    })
  const clearSelection = () => setSelectedIds(new Set())
  const runBulkClassify = async (categoryId: string) => {
    await onBulkClassify(selectedInView, categoryId)
    clearSelection()
  }
  const runBulkResolution = async (resolution: FinStagedResolution) => {
    await onBulkResolution(selectedInView, resolution)
    clearSelection()
  }

  return (
    <div className="space-y-3">
      {/* 하위 탭 */}
      <div className="flex items-center gap-1.5 border-b pb-2">
        {[
          { value: 'all', label: '전체', count: counts.total },
          { value: 'unclassified', label: '미분류', count: counts.unclassified },
          { value: 'review', label: '검토', count: counts.review },
          { value: 'dup', label: '중복', count: counts.dup },
          { value: 'classified', label: '완료', count: counts.classified },
        ].map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => onTabChange(t.value)}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              tab === t.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  tab === t.value ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted'
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 테이블 */}
      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중...</p>
      ) : !hasDraft ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          처리 대기 중인 내역이 없습니다
        </p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">해당 탭에 내역이 없습니다</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="w-9">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="전체 선택"
                  />
                </TableHead>
                <TableHead className="w-24">날짜</TableHead>
                <TableHead className="w-28">출처</TableHead>
                <TableHead>적요</TableHead>
                <TableHead className="w-28 text-right">금액</TableHead>
                <TableHead className="w-44">계정과목</TableHead>
                <TableHead className="w-24">상태</TableHead>
                <TableHead className="w-28">중복 처리</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <StagingRow
                  key={row.id}
                  row={row}
                  selected={selectedIds.has(row.id)}
                  onToggleSelect={() => toggleOne(row.id)}
                  leafTargets={leafTargets}
                  categoryTree={categoryTree}
                  reloadCategories={reloadCategories}
                  onClassify={onClassify}
                  onDupResolution={onDupResolution}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 하단 저장 처리 버튼 — 분류완료 행만 확정 저장(임포트 무관) */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-muted-foreground">
          분류완료 <span className="font-medium text-foreground">{classifiedCount}</span>건 저장
          가능
          {heldBack > 0 && ` · 미처리 ${heldBack}건 보류`}
        </p>
        <Button onClick={onCommitRequest} disabled={classifiedCount === 0} size="sm">
          저장 처리
        </Button>
      </div>

      {/* 다중 선택 일괄 처리 바 */}
      <StagingBulkBar
        selectedCount={selectedInView.length}
        leafTargets={leafTargets}
        onClassify={runBulkClassify}
        onResolution={runBulkResolution}
        onClear={clearSelection}
      />
    </div>
  )
}

// ─── 다중 선택 일괄 처리 바 ────────────────────────────────────────────────────

function StagingBulkBar({
  selectedCount,
  leafTargets,
  onClassify,
  onResolution,
  onClear,
}: {
  selectedCount: number
  leafTargets: ComboOption[]
  onClassify: (categoryId: string) => Promise<void>
  onResolution: (resolution: FinStagedResolution) => Promise<void>
  onClear: () => void
}) {
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  return (
    <FloatingActionBar
      open={selectedCount > 0}
      onClear={onClear}
      clearDisabled={busy}
      actions={
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-background/70">계정과목</span>
            <CategoryCombobox
              options={leafTargets}
              value={null}
              onChange={(id) => void run(() => onClassify(id))}
              placeholder="일괄 분류"
              triggerClassName="h-8 w-44 border-background/20 bg-background/10 text-xs text-background"
              disabled={busy}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={floatingActionButtonClass}
            onClick={() => void run(() => onResolution('DUP_SAME'))}
            disabled={busy}
          >
            제외
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={floatingActionButtonClass}
            onClick={() => void run(() => onResolution('NEW'))}
            disabled={busy}
          >
            유지
          </Button>
        </>
      }
    >
      <span className="text-sm font-semibold">{selectedCount}개 선택됨</span>
    </FloatingActionBar>
  )
}

// ─── 스테이징 행 ──────────────────────────────────────────────────────────────

function StagingRow({
  row,
  selected,
  onToggleSelect,
  leafTargets,
  categoryTree,
  reloadCategories,
  onClassify,
  onDupResolution,
}: {
  row: StagedRow
  selected: boolean
  onToggleSelect: () => void
  leafTargets: ComboOption[]
  categoryTree: CategoryNode[]
  reloadCategories: () => Promise<void>
  onClassify: (rowId: string, categoryId: string) => void
  onDupResolution: (rowId: string, resolution: FinStagedResolution) => void
}) {
  const isDup = row.resolution === 'DUP_SAME' || row.resolution === 'DUP_CHANGED'
  const statusBadge = classStatusBadge(row.classStatus)

  return (
    <TableRow
      data-state={selected ? 'selected' : undefined}
      className={isDup && row.resolution === 'DUP_SAME' ? 'opacity-50' : ''}
    >
      {/* 선택 */}
      <TableCell>
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label="행 선택" />
      </TableCell>

      {/* 날짜 */}
      <TableCell className="font-mono text-xs">{fmtDate(row.txnDate)}</TableCell>

      {/* 출처 칩 */}
      <TableCell>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
          <span className="text-muted-foreground">{accountKindLabel(row.account.kind)}</span>
          <span className="font-medium">{row.account.name}</span>
        </span>
      </TableCell>

      {/* 적요 */}
      <TableCell>
        <span className="block max-w-[280px] truncate text-xs" title={row.description ?? ''}>
          {row.description ?? row.counterparty ?? '-'}
        </span>
      </TableCell>

      {/* 금액 */}
      <TableCell className="text-right">
        <span
          className={`font-mono text-xs font-medium ${
            row.direction === 'OUT'
              ? 'text-red-600 dark:text-red-400'
              : 'text-emerald-700 dark:text-emerald-400'
          }`}
        >
          {row.direction === 'OUT' ? '-' : '+'}
          {formatWon(row.amount)}
        </span>
      </TableCell>

      {/* 계정과목 inline Select (+ 계정과목 추가 팝업) + 미분류 시 AI 추천 */}
      <TableCell>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <CategorySelect
              value={row.categoryId}
              options={leafTargets}
              categoryTree={categoryTree}
              reloadCategories={reloadCategories}
              onSelect={(categoryId) => onClassify(row.id, categoryId)}
            />
            {/* 규칙 힌트 */}
            {row.matchedRuleId && row.category && (
              <span className="text-[10px] text-muted-foreground">규칙</span>
            )}
          </div>
          {row.classStatus !== 'CLASSIFIED' && (
            <SuggestCell
              rowId={row.id}
              ruleSuggestion={row.ruleSuggestion}
              onApply={(categoryId) => onClassify(row.id, categoryId)}
            />
          )}
        </div>
      </TableCell>

      {/* 상태 배지 */}
      <TableCell>
        <Badge variant="outline" className={`text-xs ${statusBadge.className}`}>
          {statusBadge.label}
        </Badge>
      </TableCell>

      {/* 중복 처리 */}
      <TableCell>
        {isDup ? (
          <div className="flex items-center gap-1">
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400"
            >
              중복
            </Badge>
            {row.resolution === 'DUP_SAME' ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => onDupResolution(row.id, 'DUP_CHANGED')}
                className="h-6 px-2 text-xs"
              >
                유지
              </Button>
            ) : (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => onDupResolution(row.id, 'DUP_CHANGED')}
                  className="h-6 px-2 text-xs"
                >
                  유지
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onDupResolution(row.id, 'DUP_SAME')}
                  className="h-6 px-2 text-xs text-muted-foreground"
                >
                  제외
                </Button>
              </>
            )}
          </div>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

// ─── 전체 거래 패널 ───────────────────────────────────────────────────────────

function TransactionsPanel({
  rows,
  total,
  summary,
  loading,
  filterQ,
  filterAccountId,
  filterDirection,
  filterClassStatus,
  accounts,
  leafTargets,
  categoryTree,
  reloadCategories,
  onFilterQChange,
  onFilterAccountIdChange,
  onFilterDirectionChange,
  onFilterClassStatusChange,
  onSearch,
  onClassify,
  onBulkClassify,
  onBulkDelete,
}: {
  rows: Transaction[]
  total: number
  summary: TransactionSummary
  loading: boolean
  filterQ: string
  filterAccountId: string
  filterDirection: 'all' | 'IN' | 'OUT'
  filterClassStatus: 'all' | 'CLASSIFIED' | 'REVIEW' | 'UNCLASSIFIED'
  accounts: { id: string; name: string; kind: FinAccountKind }[]
  leafTargets: ComboOption[]
  categoryTree: CategoryNode[]
  reloadCategories: () => Promise<void>
  onFilterQChange: (v: string) => void
  onFilterAccountIdChange: (v: string) => void
  onFilterDirectionChange: (v: 'all' | 'IN' | 'OUT') => void
  onFilterClassStatusChange: (v: 'all' | 'CLASSIFIED' | 'REVIEW' | 'UNCLASSIFIED') => void
  onSearch: () => void
  onClassify: (txnId: string, categoryId: string) => void
  onBulkClassify: (ids: string[], categoryId: string) => Promise<void>
  onBulkDelete: (ids: string[]) => Promise<void>
}) {
  // 다중 선택 — selectedInView가 현재 행으로 스코프하므로 필터/조회 후 자연히 정리된다.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleteOpen, setDeleteOpen] = useState(false)
  const rowIds = rows.map((r) => r.id)
  const selectedInView = rowIds.filter((id) => selectedIds.has(id))
  const allSelected = rowIds.length > 0 && selectedInView.length === rowIds.length
  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) rowIds.forEach((id) => next.delete(id))
      else rowIds.forEach((id) => next.add(id))
      return next
    })
  const clearSelection = () => setSelectedIds(new Set())
  const runBulkClassify = async (categoryId: string) => {
    await onBulkClassify(selectedInView, categoryId)
    clearSelection()
  }
  const runBulkDelete = async () => {
    await onBulkDelete(selectedInView)
    setDeleteOpen(false)
    clearSelection()
  }

  return (
    <div className="space-y-3">
      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filterQ}
          onChange={(e) => onFilterQChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearch()
          }}
          placeholder="적요 · 가맹점 검색"
          className="h-8 max-w-52 text-xs"
        />
        {accounts.length > 0 && (
          <Select
            value={filterAccountId || 'all'}
            onValueChange={(v) => onFilterAccountIdChange(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="출처" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 출처</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id} className="text-xs">
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select
          value={filterDirection}
          onValueChange={(v) => onFilterDirectionChange(v as 'all' | 'IN' | 'OUT')}
        >
          <SelectTrigger className="h-8 w-24 text-xs">
            <SelectValue placeholder="방향" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="IN">수입</SelectItem>
            <SelectItem value="OUT">지출</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filterClassStatus}
          onValueChange={(v) =>
            onFilterClassStatusChange(v as 'all' | 'CLASSIFIED' | 'REVIEW' | 'UNCLASSIFIED')
          }
        >
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue placeholder="분류 상태" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="CLASSIFIED">분류완료</SelectItem>
            <SelectItem value="REVIEW">검토 필요</SelectItem>
            <SelectItem value="UNCLASSIFIED">미분류</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={onSearch} className="h-8">
          검색
        </Button>

        {/* 합계 요약 */}
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">총 {total.toLocaleString('ko-KR')}건</span>
          <span className="text-emerald-700 dark:text-emerald-400">
            수입 {formatWon(summary.incomeTotal)}
          </span>
          <span className="text-red-600 dark:text-red-400">
            지출 {formatWon(summary.expenseTotal)}
          </span>
          <span
            className={`font-medium ${
              summary.net >= 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            순 {formatWon(summary.net)}
          </span>
        </div>
      </div>

      {/* 테이블 */}
      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">거래 내역이 없습니다</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="w-9">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="전체 선택"
                  />
                </TableHead>
                <TableHead className="w-24">날짜</TableHead>
                <TableHead className="w-28">출처</TableHead>
                <TableHead>적요</TableHead>
                <TableHead className="w-28 text-right">금액</TableHead>
                <TableHead className="w-44">계정과목</TableHead>
                <TableHead className="w-24">상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((txn) => (
                <TransactionRow
                  key={txn.id}
                  txn={txn}
                  selected={selectedIds.has(txn.id)}
                  onToggleSelect={() => toggleOne(txn.id)}
                  leafTargets={leafTargets}
                  categoryTree={categoryTree}
                  reloadCategories={reloadCategories}
                  onClassify={onClassify}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 다중 선택 일괄 처리 바 — 계정과목 분류 / 삭제 */}
      <TransactionsBulkBar
        selectedCount={selectedInView.length}
        leafTargets={leafTargets}
        onClassify={runBulkClassify}
        onDeleteRequest={() => setDeleteOpen(true)}
        onClear={clearSelection}
      />

      {/* 삭제 확인 — 되돌릴 수 없음 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>거래 삭제</DialogTitle>
            <DialogDescription>
              선택한 <strong>{selectedInView.length}건</strong>의 확정 거래를 삭제합니다. 되돌릴 수
              없으며, 영향 계좌의 월말 잔고가 다시 계산됩니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              취소
            </Button>
            <Button variant="destructive" onClick={() => void runBulkDelete()}>
              {selectedInView.length}건 삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── 전체 거래 다중 선택 일괄 처리 바 ──────────────────────────────────────────

function TransactionsBulkBar({
  selectedCount,
  leafTargets,
  onClassify,
  onDeleteRequest,
  onClear,
}: {
  selectedCount: number
  leafTargets: ComboOption[]
  onClassify: (categoryId: string) => Promise<void>
  onDeleteRequest: () => void
  onClear: () => void
}) {
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  return (
    <FloatingActionBar
      open={selectedCount > 0}
      onClear={onClear}
      clearDisabled={busy}
      actions={
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-background/70">계정과목</span>
            <CategoryCombobox
              options={leafTargets}
              value={null}
              onChange={(id) => void run(() => onClassify(id))}
              placeholder="일괄 분류"
              triggerClassName="h-8 w-44 border-background/20 bg-background/10 text-xs text-background"
              disabled={busy}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1 px-2.5 text-xs text-red-300 hover:bg-red-500/20 hover:text-red-200"
            onClick={onDeleteRequest}
            disabled={busy}
          >
            <Trash2 className="size-3.5" />
            삭제
          </Button>
        </>
      }
    >
      <span className="text-sm font-semibold">{selectedCount}개 선택됨</span>
    </FloatingActionBar>
  )
}

// ─── 확정 거래 행 ─────────────────────────────────────────────────────────────

function TransactionRow({
  txn,
  selected,
  onToggleSelect,
  leafTargets,
  categoryTree,
  reloadCategories,
  onClassify,
}: {
  txn: Transaction
  selected: boolean
  onToggleSelect: () => void
  leafTargets: ComboOption[]
  categoryTree: CategoryNode[]
  reloadCategories: () => Promise<void>
  onClassify: (txnId: string, categoryId: string) => void
}) {
  const statusBadge = classStatusBadge(txn.classStatus)

  return (
    <TableRow data-state={selected ? 'selected' : undefined}>
      {/* 선택 */}
      <TableCell>
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label="행 선택" />
      </TableCell>

      {/* 날짜 */}
      <TableCell className="font-mono text-xs">{fmtDate(txn.txnDate)}</TableCell>

      {/* 출처 */}
      <TableCell>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
          <span className="text-muted-foreground">{accountKindLabel(txn.account.kind)}</span>
          <span className="font-medium">{txn.account.name}</span>
        </span>
      </TableCell>

      {/* 적요 */}
      <TableCell>
        <span className="block max-w-[280px] truncate text-xs" title={txn.description ?? ''}>
          {txn.description ?? txn.counterparty ?? '-'}
        </span>
      </TableCell>

      {/* 금액 */}
      <TableCell className="text-right">
        <span
          className={`font-mono text-xs font-medium ${
            txn.direction === 'OUT'
              ? 'text-red-600 dark:text-red-400'
              : 'text-emerald-700 dark:text-emerald-400'
          }`}
        >
          {txn.direction === 'OUT' ? '-' : '+'}
          {formatWon(txn.amount)}
        </span>
      </TableCell>

      {/* 계정과목 inline Select (+ 계정과목 추가 팝업) */}
      <TableCell>
        <div className="flex items-center gap-1.5">
          <CategorySelect
            value={txn.categoryId}
            options={leafTargets}
            categoryTree={categoryTree}
            reloadCategories={reloadCategories}
            onSelect={(categoryId) => onClassify(txn.id, categoryId)}
          />
          {txn.matchedRuleId && txn.category && (
            <span className="text-[10px] text-muted-foreground">규칙</span>
          )}
        </div>
      </TableCell>

      {/* 상태 배지 */}
      <TableCell>
        <Badge variant="outline" className={`text-xs ${statusBadge.className}`}>
          {statusBadge.label}
        </Badge>
      </TableCell>
    </TableRow>
  )
}

// ─── 계정과목 선택 + 인라인 추가 ────────────────────────────────────────────────

/**
 * 계정과목 검색형 선택기(콤보박스). 드롭다운 하단에 '+ 계정과목 추가'가 있고, 계정과목이 하나도
 * 없으면 재로드(자가복구) 버튼만 노출한다. 추가 성공 시 계정과목을 재로드하고 해당 거래에 즉시 매칭.
 */
function CategorySelect({
  value,
  options,
  categoryTree,
  reloadCategories,
  onSelect,
}: {
  value: string | null
  options: ComboOption[]
  categoryTree: CategoryNode[]
  reloadCategories: () => Promise<void>
  onSelect: (categoryId: string) => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)

  // 추가된 계정과목을 재로드 후 이 거래에 즉시 매칭
  const handleCreated = async (category: { id: string }) => {
    await reloadCategories()
    onSelect(category.id)
  }

  // 빈 상태(계정과목 없음) — 새 계정과목은 상위 그룹(수익/비용/이체)이 있어야 추가 가능하므로,
  // 여기선 추가 팝업 대신 재로드로 표준 계정과목(K-IFRS)을 자가복구한다. 복구 후 콤보박스의
  // '+ 계정과목 추가'로 사용자 계정과목을 더할 수 있다. 복구 실패 시 loadCategories가 토스트로 알림.
  if (options.length === 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={() => void reloadCategories()}
      >
        <Plus className="size-3.5" />
        계정과목 불러오기
      </Button>
    )
  }

  return (
    <>
      <CategoryCombobox
        options={options}
        value={value}
        onChange={onSelect}
        triggerClassName="h-7 w-44 text-xs"
        onAddNew={() => setDialogOpen(true)}
      />
      <AddCategoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        categoryTree={categoryTree}
        onCreated={handleCreated}
      />
    </>
  )
}

// ─── 계정 추천(미분류 거래): 룰(키워드) 자동 표시 + AI 별도 버튼 ─────────────────

type SuggestSource = 'rule' | 'ai'
type SuggestionData = { categoryId: string; categoryName: string; reason: string }

/**
 * 미분류 거래에 계정 항목 추천.
 *  - 룰(키워드) 추천: 서버가 스테이징 GET에서 배치 계산(`ruleSuggestion`) → **버튼 없이 자동 표시**.
 *  - [AI 추천]: Gemini. 룰로 못 잡거나(없음) 다르게 보고 싶을 때 명시적으로 누른다(AI가 룰 표시를 덮음).
 * 수락(적용)하면 onApply로 기존 분류 경로(PATCH + 동일 적요 자동적용 + 규칙 학습)를 그대로 탄다.
 */
function SuggestCell({
  rowId,
  ruleSuggestion,
  onApply,
}: {
  rowId: string
  ruleSuggestion: SuggestionData | null
  onApply: (categoryId: string) => void
}) {
  const [aiSuggestion, setAiSuggestion] = useState<SuggestionData | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // AI가 있으면 AI 우선, 없으면(무시 안 했고 룰 있으면) 룰 자동 표시.
  const active: (SuggestionData & { source: SuggestSource }) | null = aiSuggestion
    ? { source: 'ai', ...aiSuggestion }
    : !dismissed && ruleSuggestion
      ? { source: 'rule', ...ruleSuggestion }
      : null

  const fetchAi = async () => {
    setAiLoading(true)
    try {
      const res = await fetch(`/api/finance/staging/${rowId}/suggest`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? 'AI 추천 실패')
      if (data?.suggestion) setAiSuggestion(data.suggestion)
      else toast('AI가 추천할 항목을 찾지 못했어요')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI 추천을 사용할 수 없습니다')
    } finally {
      setAiLoading(false)
    }
  }

  if (active) {
    const isAi = active.source === 'ai'
    return (
      <div className="flex items-center gap-1" title={active.reason}>
        {isAi ? (
          <Sparkles className="size-3 shrink-0 text-violet-500" />
        ) : (
          <Tag className="size-3 shrink-0 text-sky-500" />
        )}
        <span className="max-w-[88px] truncate text-[11px] text-muted-foreground">
          {active.categoryName}
        </span>
        <Button
          size="xs"
          variant="outline"
          className="h-5 px-1.5 text-[10px]"
          onClick={() => onApply(active.categoryId)}
        >
          적용
        </Button>
        {!isAi && (
          <button
            type="button"
            onClick={() => void fetchAi()}
            disabled={aiLoading}
            title="AI로 다시 추천"
            className="flex items-center gap-0.5 text-[10px] text-violet-600 hover:underline disabled:opacity-50 dark:text-violet-400"
          >
            <Sparkles className="size-3" />
            {aiLoading ? '…' : 'AI'}
          </button>
        )}
        <button
          type="button"
          className="text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => {
            setAiSuggestion(null)
            setDismissed(true)
          }}
          aria-label="무시"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void fetchAi()}
      disabled={aiLoading}
      className="flex w-fit items-center gap-1 text-[11px] text-violet-600 hover:underline disabled:opacity-50 dark:text-violet-400"
    >
      <Sparkles className="size-3" />
      {aiLoading ? 'AI 추천 중...' : 'AI 추천'}
    </button>
  )
}

/**
 * 계정과목 추가 다이얼로그 — 상위 계정과목(수익/비용/이체) 아래에 새 계정과목을 만들고
 * 생성된 계정과목을 호출자에게 넘겨 즉시 매칭하게 한다. POST /api/finance/categories 재사용.
 */
function AddCategoryDialog({
  open,
  onOpenChange,
  categoryTree,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  categoryTree: CategoryNode[]
  onCreated: (category: { id: string }) => Promise<void> | void
}) {
  const [parentId, setParentId] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const parentOptions = useMemo(() => buildParentOptions(categoryTree), [categoryTree])

  async function handleSave() {
    if (!parentId) {
      toast.error('상위 계정과목을 선택해 주세요')
      return
    }
    if (!name.trim()) {
      toast.error('계정과목 이름을 입력해 주세요')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/finance/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, name: name.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        message?: string
        category?: { id: string }
      }
      if (!res.ok || !data.category) throw new Error(data?.message ?? '계정과목 추가 실패')
      toast.success('계정과목이 추가되어 이 거래에 적용되었습니다')
      setName('')
      setParentId('')
      onOpenChange(false)
      await onCreated(data.category)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '계정과목 추가 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>계정과목 추가</DialogTitle>
          <DialogDescription>
            상위 계정과목 아래에 새 계정과목을 추가하고 이 거래에 바로 적용합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">상위 계정과목</Label>
            <CategoryCombobox
              options={parentOptions}
              value={parentId || null}
              onChange={setParentId}
              placeholder="수익 / 비용 / 이체 선택"
              triggerClassName="h-9 w-full text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">계정과목 이름</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 플랫폼 수수료"
              className="h-9 text-sm"
              maxLength={100}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave()
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '추가 중...' : '추가하고 적용'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
