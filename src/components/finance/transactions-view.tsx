'use client'

/**
 * 재무 관리 Deck — P5 거래 내역(확인·처리) 뷰
 * 탭 1: 확인·처리(스테이징 DRAFT 행)
 * 탭 2: 전체 거래(확정 FinTransaction)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
import type { FinAccountKind, FinClassStatus, FinStagedResolution } from '@/generated/prisma/enums'

// ─── 타입 정의 ───────────────────────────────────────────────────────────────

type CategoryNode = {
  id: string
  parentId: string | null
  name: string
  type: string
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

// ─── flattenLeafTargets: INCOME/EXPENSE 잎 계정과목 평탄화 ──────────────────

function flattenLeafTargets(tree: CategoryNode[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = []
  for (const root of tree) {
    // 수입/지출 + 계좌간 이체(TRANSFER) 분류 대상. TRANSFER로 분류하면 isTransfer=true가 되어
    // 수입/지출 집계에서 제외된다(이중계상 방지).
    if (root.type !== 'INCOME' && root.type !== 'EXPENSE' && root.type !== 'TRANSFER') continue
    const tag = root.type === 'TRANSFER' ? ' (이체)' : ''
    for (const lvl1 of root.children) {
      out.push({ id: lvl1.id, label: `${lvl1.name}${tag}` })
      for (const sub of lvl1.children) {
        out.push({ id: sub.id, label: `${lvl1.name} › ${sub.name}${tag}` })
      }
    }
  }
  return out
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
  const leafTargets = useMemo(() => flattenLeafTargets(categoryTree), [categoryTree])

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
      if (!res.ok) throw new Error('분류 저장 실패')
      toast.success('동일 적요는 다음부터 자동 분류됩니다')
      void loadStaging(stagingTab)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '분류 저장 실패')
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

  // 커밋 확인 — counts는 전체 임포트 기준(탭 필터 무관)
  const dupExcluded = stagingCounts.dup // DUP_SAME + DUP_CHANGED 합산(서버 카운트)
  const newCount = stagingCounts.total - stagingCounts.dup
  const reviewRemaining = stagingCounts.review

  const handleCommit = async () => {
    if (!importIdParam) return
    setCommitting(true)
    try {
      const res = await fetch('/api/finance/staging/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId: importIdParam }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '저장 처리 실패')
      toast.success(`저장 완료 — 반영 ${data.committed}건, 제외 ${data.skipped}건`)
      setCommitDialogOpen(false)
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
          importId={importIdParam}
          leafTargets={leafTargets}
          categoryTree={categoryTree}
          reloadCategories={loadCategories}
          newCount={newCount}
          dupExcluded={dupExcluded}
          onTabChange={handleStagingTabChange}
          onClassify={handleStagingClassify}
          onDupResolution={handleDupResolution}
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
        />
      </TabsContent>

      {/* ── 커밋 확인 다이얼로그 ── */}
      <Dialog open={commitDialogOpen} onOpenChange={setCommitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>저장 처리 확인</DialogTitle>
            <DialogDescription>스테이징 행을 확정 거래로 반영합니다.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">신규 반영</span>
              <span className="font-mono font-medium">{newCount}건</span>
            </div>
            <div className="flex justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">중복 제외</span>
              <span className="font-mono font-medium">{dupExcluded}건</span>
            </div>
            {reviewRemaining > 0 && (
              <div className="flex justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950">
                <span className="text-amber-700 dark:text-amber-400">검토 잔여</span>
                <span className="font-mono font-medium text-amber-700 dark:text-amber-400">
                  {reviewRemaining}건
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
    </Tabs>
  )
}

// ─── 확인·처리 패널 ──────────────────────────────────────────────────────────

function StagingPanel({
  rows,
  counts,
  loading,
  tab,
  importId,
  leafTargets,
  categoryTree,
  reloadCategories,
  newCount,
  dupExcluded,
  onTabChange,
  onClassify,
  onDupResolution,
  onCommitRequest,
}: {
  rows: StagedRow[]
  counts: StagedCounts
  loading: boolean
  tab: string
  importId: string | undefined
  leafTargets: { id: string; label: string }[]
  categoryTree: CategoryNode[]
  reloadCategories: () => Promise<void>
  newCount: number
  dupExcluded: number
  onTabChange: (tab: string) => void
  onClassify: (rowId: string, categoryId: string) => void
  onDupResolution: (rowId: string, resolution: FinStagedResolution) => void
  onCommitRequest: () => void
}) {
  const hasDraft = counts.total > 0

  return (
    <div className="space-y-3">
      {/* 안내 배너 */}
      {(counts.review > 0 || counts.unclassified > 0 || counts.dup > 0) && (
        <Alert className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
          <AlertDescription className="text-xs text-amber-700 dark:text-amber-400">
            검토 필요 <strong>{counts.review}</strong>건 · 미분류{' '}
            <strong>{counts.unclassified}</strong>건 · 중복 의심 <strong>{counts.dup}</strong>건
          </AlertDescription>
        </Alert>
      )}

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

      {/* 하단 저장 처리 버튼 */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-muted-foreground">
          {importId
            ? `임포트 ${importId.slice(0, 8)}…`
            : '임포트 미지정 — importId 파라미터를 지정해야 저장할 수 있습니다'}
        </p>
        <Button
          onClick={onCommitRequest}
          disabled={!importId || newCount + dupExcluded === 0}
          size="sm"
        >
          저장 처리
        </Button>
      </div>
    </div>
  )
}

// ─── 스테이징 행 ──────────────────────────────────────────────────────────────

function StagingRow({
  row,
  leafTargets,
  categoryTree,
  reloadCategories,
  onClassify,
  onDupResolution,
}: {
  row: StagedRow
  leafTargets: { id: string; label: string }[]
  categoryTree: CategoryNode[]
  reloadCategories: () => Promise<void>
  onClassify: (rowId: string, categoryId: string) => void
  onDupResolution: (rowId: string, resolution: FinStagedResolution) => void
}) {
  const isDup = row.resolution === 'DUP_SAME' || row.resolution === 'DUP_CHANGED'
  const statusBadge = classStatusBadge(row.classStatus)

  // 계정과목 표시 레이블
  const categoryLabel = row.category
    ? row.category.parent
      ? `${row.category.parent.name} › ${row.category.name}`
      : row.category.name
    : ''

  return (
    <TableRow className={isDup && row.resolution === 'DUP_SAME' ? 'opacity-50' : ''}>
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

      {/* 계정과목 inline Select (+ 계정과목 추가 팝업) */}
      <TableCell>
        <div className="flex items-center gap-1.5">
          <CategorySelect
            value={row.categoryId}
            currentLabel={categoryLabel}
            leafTargets={leafTargets}
            categoryTree={categoryTree}
            reloadCategories={reloadCategories}
            onSelect={(categoryId) => onClassify(row.id, categoryId)}
          />
          {/* 규칙 힌트 */}
          {row.matchedRuleId && row.category && (
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
  leafTargets: { id: string; label: string }[]
  categoryTree: CategoryNode[]
  reloadCategories: () => Promise<void>
  onFilterQChange: (v: string) => void
  onFilterAccountIdChange: (v: string) => void
  onFilterDirectionChange: (v: 'all' | 'IN' | 'OUT') => void
  onFilterClassStatusChange: (v: 'all' | 'CLASSIFIED' | 'REVIEW' | 'UNCLASSIFIED') => void
  onSearch: () => void
  onClassify: (txnId: string, categoryId: string) => void
}) {
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
    </div>
  )
}

// ─── 확정 거래 행 ─────────────────────────────────────────────────────────────

function TransactionRow({
  txn,
  leafTargets,
  categoryTree,
  reloadCategories,
  onClassify,
}: {
  txn: Transaction
  leafTargets: { id: string; label: string }[]
  categoryTree: CategoryNode[]
  reloadCategories: () => Promise<void>
  onClassify: (txnId: string, categoryId: string) => void
}) {
  const statusBadge = classStatusBadge(txn.classStatus)
  const categoryLabel = txn.category
    ? txn.category.parent
      ? `${txn.category.parent.name} › ${txn.category.name}`
      : txn.category.name
    : ''

  return (
    <TableRow>
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
            currentLabel={categoryLabel}
            leafTargets={leafTargets}
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
 * 계정과목 inline Select. 드롭다운 하단에 '+ 계정과목 추가'가 있고, 계정과목이 하나도 없으면
 * Select 대신 추가 버튼만 노출한다. 추가 성공 시 계정과목을 재로드하고 해당 거래에 즉시 매칭한다.
 */
function CategorySelect({
  value,
  currentLabel,
  leafTargets,
  categoryTree,
  reloadCategories,
  onSelect,
}: {
  value: string | null
  currentLabel: string
  leafTargets: { id: string; label: string }[]
  categoryTree: CategoryNode[]
  reloadCategories: () => Promise<void>
  onSelect: (categoryId: string) => void
}) {
  const [selectOpen, setSelectOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  // 추가된 계정과목을 재로드 후 이 거래에 즉시 매칭
  const handleCreated = async (category: { id: string }) => {
    await reloadCategories()
    onSelect(category.id)
  }

  const dialog = (
    <AddCategoryDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      categoryTree={categoryTree}
      onCreated={handleCreated}
    />
  )

  // 빈 상태(계정과목 없음) — 새 계정과목은 상위 그룹(수익/비용/이체)이 있어야 추가 가능하므로,
  // 여기선 추가 팝업 대신 재로드로 표준 계정과목(K-IFRS)을 자가복구한다. 복구 후 일반 드롭다운의
  // '+ 계정과목 추가'로 사용자 계정과목을 더할 수 있다. 복구 실패 시 loadCategories가 토스트로 알림.
  if (leafTargets.length === 0) {
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
      <Select
        open={selectOpen}
        onOpenChange={setSelectOpen}
        value={value ?? ''}
        onValueChange={(v) => onSelect(v)}
      >
        <SelectTrigger className="h-7 w-40 text-xs">
          <SelectValue placeholder="계정과목 선택">{currentLabel || '계정과목 선택'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {leafTargets.map((t) => (
            <SelectItem key={t.id} value={t.id} className="text-xs">
              {t.label}
            </SelectItem>
          ))}
          <div className="mt-1 border-t pt-1">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSelectOpen(false)
                setDialogOpen(true)
              }}
              className="flex w-full items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-primary hover:bg-accent"
            >
              <Plus className="size-3.5" />
              계정과목 추가
            </button>
          </div>
        </SelectContent>
      </Select>
      {dialog}
    </>
  )
}

/** 분류 타깃이 될 수 있는 상위 계정과목(수익/비용/이체의 root + lvl1) 옵션. */
function collectParentOptions(tree: CategoryNode[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = []
  for (const root of tree) {
    if (root.type !== 'INCOME' && root.type !== 'EXPENSE' && root.type !== 'TRANSFER') continue
    out.push({ id: root.id, label: root.name })
    for (const lvl1 of root.children) {
      out.push({ id: lvl1.id, label: `${root.name} › ${lvl1.name}` })
    }
  }
  return out
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
  const parentOptions = useMemo(() => collectParentOptions(categoryTree), [categoryTree])

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
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="수익 / 비용 / 이체 선택" />
              </SelectTrigger>
              <SelectContent>
                {parentOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-sm">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
