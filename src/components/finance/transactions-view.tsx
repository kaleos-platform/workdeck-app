'use client'

/**
 * 재무 관리 Deck — P5 거래 내역(확인·처리) 뷰
 * 탭 1: 확인·처리(스테이징 DRAFT 행)
 * 탭 2: 전체 거래(확정 FinTransaction)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2, Sparkles, Tag, X, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
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
import { MEMO_MAX } from '@/lib/finance/memo'
import { CategoryCombobox } from '@/components/finance/category-combobox'
import { AddCategoryDialog } from '@/components/finance/add-category-dialog'
import {
  buildClassifyOptions,
  comboOptionLabel,
  type ComboOption,
} from '@/lib/finance/category-options'
import type {
  FinAccountKind,
  FinCategoryType,
  FinClassStatus,
  FinStagedResolution,
} from '@/generated/prisma/enums'

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
  cancelFlag: string | null
  memo: string | null
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
  cancelFlag: string | null
  memo: string | null
  isTransfer: boolean
  classStatus: FinClassStatus
  matchedRuleId: string | null
  categoryId: string | null
  category: { id: string; name: string; type: string; parent: { name: string } | null } | null
  account: { id: string; name: string; kind: FinAccountKind }
  /** 연결된 부채 상환 정보 */
  liabilityId: string | null
  liability: { id: string; name: string } | null
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

// 전체 거래 정렬 가능한 컬럼 키(API sort 파라미터와 1:1).
type TxnSortField =
  | 'txnDate'
  | 'account'
  | 'description'
  | 'amount'
  | 'balanceAfter'
  | 'category'
  | 'classStatus'

export function TransactionsView() {
  // 카테고리 트리 + 잎 목록
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([])
  const leafTargets = useMemo(() => buildClassifyOptions(categoryTree), [categoryTree])

  // 계좌 목록 (전체 거래 출처 필터)
  const [accounts, setAccounts] = useState<
    {
      id: string
      name: string
      kind: FinAccountKind
      institution: string | null
      accountNumber: string | null
    }[]
  >([])

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
  const [txnLoadingMore, setTxnLoadingMore] = useState(false)
  const [txnSummary, setTxnSummary] = useState<TransactionSummary>({
    incomeTotal: 0,
    expenseTotal: 0,
    net: 0,
  })
  const [txnLoading, setTxnLoading] = useState(false)

  // 딥링크(현금흐름 상세 → 거래내역): URL 쿼리로 기간·계정과목·방향 필터 초기화.
  const searchParams = useSearchParams()

  // 필터 (전체 거래) — 'all'은 파라미터 미포함 센티넬. 초기값은 딥링크 파라미터에서 주입.
  const [filterQ, setFilterQ] = useState('')
  const [filterAccountId, setFilterAccountId] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState(() => searchParams.get('categoryId') ?? '')
  const [filterDirection, setFilterDirection] = useState<'all' | 'IN' | 'OUT'>(() => {
    const d = searchParams.get('direction')
    return d === 'IN' || d === 'OUT' ? d : 'all'
  })
  // 기간 필터(YYYY-MM-DD) — 필터 바 날짜 입력칸으로 편집.
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('from') ?? '')
  const [dateTo, setDateTo] = useState(() => searchParams.get('to') ?? '')
  // 다중 계정과목/미분류(대분류 딥링크) — 단일 콤보에 안 들어가므로 배너로 표시.
  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>(() => {
    const raw = searchParams.get('categoryIds')
    return raw ? raw.split(',').filter(Boolean) : []
  })
  const [filterUncategorized, setFilterUncategorized] = useState(
    () => searchParams.get('uncategorized') === '1'
  )
  const [filterCatLabel, setFilterCatLabel] = useState<string | null>(
    () => searchParams.get('label')
  )
  const [filterExcludeTransfer, setFilterExcludeTransfer] = useState(
    () => searchParams.get('excludeTransfer') === '1'
  )
  // 배너(그룹/미분류 계정과목) 활성 여부 — 활성 중엔 단일 계정과목 콤보 무시.
  const catBannerActive = filterCategoryIds.length > 0 || filterUncategorized
  // 딥링크 진입 여부 — 스테이징 대신 전체 거래 탭을 강제로 연다.
  const hasDeepLink = useMemo(() => {
    for (const k of ['from', 'to', 'direction', 'categoryId', 'categoryIds', 'uncategorized']) {
      if (searchParams.get(k)) return true
    }
    return false
  }, [searchParams])
  // 정렬(전체 거래) — 컬럼 헤더 클릭. 서버사이드(전체 데이터셋 정확).
  const [txnSort, setTxnSort] = useState<{ field: TxnSortField; order: 'asc' | 'desc' }>({
    field: 'txnDate',
    order: 'desc',
  })

  // 메인 탭 — 초기값은 로드 후 결정
  const [mainTab, setMainTab] = useState<'staging' | 'transactions'>('staging')
  const [mainTabReady, setMainTabReady] = useState(false)

  // 커밋 다이얼로그
  const [commitDialogOpen, setCommitDialogOpen] = useState(false)
  const [committing, setCommitting] = useState(false)

  // 분류 직후 동일 적요 자동 적용 다이얼로그 — 분류 확인 팝업의 메모도 함께 전파
  const [autoApply, setAutoApply] = useState<{
    categoryId: string
    siblingIds: string[]
    memo: string | null
  } | null>(null)

  // 분류 확인 팝업(스테이징 전용) — 규칙 저장 여부(기본 on) + 메모 입력 후 적용
  const [classifyConfirm, setClassifyConfirm] = useState<{
    rowId: string
    categoryId: string
    categoryLabel: string
    memo: string | null
  } | null>(null)
  const [classifySaving, setClassifySaving] = useState(false)

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
        (data.accounts ?? []).map(
          (a: {
            id: string
            name: string
            kind: FinAccountKind
            institution: string | null
            accountNumber: string | null
          }) => ({
            id: a.id,
            name: a.name,
            kind: a.kind,
            institution: a.institution ?? null,
            accountNumber: a.accountNumber ?? null,
          })
        )
      )
    } catch {
      // 조용히 실패
    }
  }, [])

  // 스테이징 조회
  const loadStaging = useCallback(async (tab: string = 'all') => {
    setStagingLoading(true)
    try {
      const params = new URLSearchParams({ tab })
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
  }, [])

  // 확정 거래 조회 (skip=0이면 초기/리셋, skip>0이면 추가 로드)
  const loadTransactions = useCallback(
    async (skip = 0) => {
      if (skip === 0) {
        setTxnLoading(true)
      } else {
        setTxnLoadingMore(true)
      }
      try {
        const params = new URLSearchParams()
        if (filterQ) params.set('q', filterQ)
        if (filterAccountId) params.set('accountId', filterAccountId)
        // 배너(다중/미분류) 활성 시 단일 계정과목은 무시(충돌 방지).
        if (filterCategoryId && !catBannerActive) params.set('categoryId', filterCategoryId)
        if (filterDirection !== 'all') params.set('direction', filterDirection)
        if (dateFrom) params.set('from', dateFrom)
        if (dateTo) params.set('to', dateTo)
        if (filterCategoryIds.length) params.set('categoryIds', filterCategoryIds.join(','))
        if (filterUncategorized) params.set('uncategorized', '1')
        if (filterExcludeTransfer) params.set('excludeTransfer', '1')
        params.set('sort', txnSort.field)
        params.set('order', txnSort.order)
        if (skip > 0) params.set('skip', String(skip))
        const res = await fetch(`/api/finance/transactions?${params}`)
        if (!res.ok) throw new Error('거래 내역 조회 실패')
        const data = await res.json()
        if (skip === 0) {
          setTxnRows(data.rows ?? [])
        } else {
          setTxnRows((prev) => [...prev, ...(data.rows ?? [])])
        }
        setTxnTotal(data.total ?? 0)
        setTxnSummary(data.summary ?? { incomeTotal: 0, expenseTotal: 0, net: 0 })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '거래 내역 조회 실패')
      } finally {
        if (skip === 0) {
          setTxnLoading(false)
        } else {
          setTxnLoadingMore(false)
        }
      }
    },
    [
      filterQ,
      filterAccountId,
      filterCategoryId,
      catBannerActive,
      filterDirection,
      dateFrom,
      dateTo,
      filterCategoryIds,
      filterUncategorized,
      filterExcludeTransfer,
      txnSort.field,
      txnSort.order,
    ]
  )

  // 초기 로드
  useEffect(() => {
    void loadCategories()
    void loadAccounts()
    void loadStaging('all').then(() => {
      // counts 반영 후 탭 결정
      setMainTabReady(true)
    })
  }, [loadCategories, loadAccounts, loadStaging])

  // 기본 탭 결정 — mainTabReady 시점(스테이징 counts 확정)에 정확히 1회.
  // 딥링크 진입=전체 거래 강제. ref 게이트로 이후 스테이징 분류에 의한 재강제 방지.
  const tabInitializedRef = useRef(false)
  useEffect(() => {
    if (!mainTabReady || tabInitializedRef.current) return
    tabInitializedRef.current = true
    setMainTab(hasDeepLink ? 'transactions' : stagingCounts.total > 0 ? 'staging' : 'transactions')
  }, [mainTabReady, stagingCounts.total, hasDeepLink])

  // 전체 거래 탭 전환 시 조회
  useEffect(() => {
    if (mainTab === 'transactions') {
      void loadTransactions()
    }
  }, [mainTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // 정렬 변경 시 재조회(전체 거래 탭에서만). 필터는 검색 버튼으로 명시 조회하지만 정렬은 즉시 반영.
  useEffect(() => {
    if (mainTab === 'transactions') {
      void loadTransactions(0)
    }
  }, [txnSort.field, txnSort.order]) // eslint-disable-line react-hooks/exhaustive-deps

  // 컬럼 헤더 클릭: 같은 컬럼이면 방향 토글, 다른 컬럼이면 기본 방향(일자·금액·잔액=desc, 텍스트=asc).
  const handleTxnSort = useCallback((field: TxnSortField) => {
    setTxnSort((prev) =>
      prev.field === field
        ? { field, order: prev.order === 'asc' ? 'desc' : 'asc' }
        : {
            field,
            order:
              field === 'txnDate' || field === 'amount' || field === 'balanceAfter'
                ? 'desc'
                : 'asc',
          }
    )
  }, [])

  // 스테이징 하위 탭 변경
  const handleStagingTabChange = (tab: string) => {
    setStagingTab(tab)
    void loadStaging(tab)
  }

  // 스테이징 categoryId 선택 — 즉시 저장 대신 확인 팝업(규칙 저장 여부 + 메모)을 연다.
  // CategorySelect·추천(SuggestCell) 적용 모두 이 경로를 탄다.
  const handleStagingClassify = (rowId: string, categoryId: string) => {
    const row = stagingRows.find((r) => r.id === rowId)
    setClassifyConfirm({
      rowId,
      categoryId,
      categoryLabel: comboOptionLabel(leafTargets, categoryId) || '선택한 계정과목',
      memo: row?.memo ?? null,
    })
  }

  // 분류 확인 팝업 적용 — learn=규칙 저장 체크값, 메모 함께 저장(규칙 저장 시 규칙에도 반영)
  const handleClassifyConfirmApply = async (learn: boolean, memoInput: string) => {
    if (!classifyConfirm) return
    const { rowId, categoryId } = classifyConfirm
    const memo = memoInput.trim() === '' ? null : memoInput.trim()
    setClassifySaving(true)
    try {
      const res = await fetch(`/api/finance/staging/${rowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId, learn, memo }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '분류 저장 실패')
      setClassifyConfirm(null)
      void loadStaging(stagingTab)
      // 동일 적요+동일 방향 미처리 행이 있으면 자동 적용 여부를 물음(메모도 함께 전파)
      const siblingIds: string[] = Array.isArray(data?.siblingIds) ? data.siblingIds : []
      if (siblingIds.length > 0) setAutoApply({ categoryId, siblingIds, memo })
      else if (learn) toast.success('동일 적요는 다음부터 자동 분류됩니다')
      else toast.success('분류가 저장되었습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '분류 저장 실패')
    } finally {
      setClassifySaving(false)
    }
  }

  // 일괄 처리(bulk 엔드포인트) — 계정과목 분류 또는 중복 처리
  const applyBulk = useCallback(
    async (payload: {
      ids: string[]
      categoryId?: string
      resolution?: FinStagedResolution
      memo?: string | null
    }) => {
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
      const n = await applyBulk({
        ids: autoApply.siblingIds,
        categoryId: autoApply.categoryId,
        // 메모가 있을 때만 전달 — 없으면 형제 행 기존 메모 유지
        ...(autoApply.memo != null ? { memo: autoApply.memo } : {}),
      })
      toast.success(`동일 적요 ${n}건에 적용했습니다`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '일괄 적용 실패')
    } finally {
      setAutoApply(null)
      void loadStaging(stagingTab)
    }
  }

  // 중복 처리: 유지 → DUP_OVERWRITE(확정 시 계정과목 덮어쓰기), 제외 → DUP_SAME
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

  // 스테이징 메모 저장/삭제(null) → PATCH. 성공 시 로컬 상태만 갱신(재조회 불필요).
  const handleStagingMemo = async (rowId: string, memo: string | null) => {
    const res = await fetch(`/api/finance/staging/${rowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memo }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data?.message ?? '메모 저장 실패')
    }
    setStagingRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, memo } : r)))
  }

  // 확정 거래 메모 저장/삭제(null) → PATCH
  const handleTxnMemo = async (txnId: string, memo: string | null) => {
    const res = await fetch(`/api/finance/transactions/${txnId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memo }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data?.message ?? '메모 저장 실패')
    }
    setTxnRows((prev) => prev.map((r) => (r.id === txnId ? { ...r, memo } : r)))
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
        // 미확정(DRAFT) 임포트 전체의 분류완료 행을 저장 — 표시된 카운트와 일치.
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '저장 처리 실패')
      toast.success(
        data.dupCleaned > 0
          ? `분류완료 ${data.committed}건 저장 · 중복 제외 ${data.dupCleaned}건 정리`
          : `분류완료 ${data.committed}건을 저장했습니다`
      )
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

  // 확정 거래 부채 상환 일괄 연결/해제
  const handleTxnBulkLinkLiability = useCallback(
    async (ids: string[], liabilityId: string | null) => {
      try {
        const res = await fetch('/api/finance/transactions/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, liabilityId }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.message ?? '연결 실패')
        toast.success(liabilityId ? '부채 상환으로 연결했습니다' : '부채 연결이 해제되었습니다')
        void loadTransactions()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '연결 실패')
      }
    },
    [loadTransactions]
  )

  // 필터 검색 실행 (skip 리셋)
  const handleTxnSearch = useCallback(() => {
    void loadTransactions(0)
  }, [loadTransactions])

  // 딥링크 배너 해제 후 재조회 — setState 반영된 최신 loadTransactions로 실행되도록 tick effect 경유.
  const [filterReloadTick, setFilterReloadTick] = useState(0)
  useEffect(() => {
    if (filterReloadTick > 0 && mainTab === 'transactions') void loadTransactions(0)
  }, [filterReloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const clearCategoryBanner = useCallback(() => {
    setFilterCategoryIds([])
    setFilterUncategorized(false)
    setFilterCatLabel(null)
    setFilterReloadTick((t) => t + 1)
  }, [])
  const clearExcludeTransfer = useCallback(() => {
    setFilterExcludeTransfer(false)
    setFilterReloadTick((t) => t + 1)
  }, [])
  const clearDates = useCallback(() => {
    setDateFrom('')
    setDateTo('')
    setFilterReloadTick((t) => t + 1)
  }, [])

  // 더 보기 — 현재 로드된 수 기준으로 다음 페이지 추가 로드
  const handleTxnLoadMore = useCallback(() => {
    void loadTransactions(txnRows.length)
  }, [loadTransactions, txnRows.length])

  return (
    <Tabs
      value={mainTab}
      onValueChange={(v) => setMainTab(v as 'staging' | 'transactions')}
      className="space-y-4"
    >
      {/* 긴 목록 스크롤 중에도 탭 전환이 가능하도록 상단 고정 */}
      <div className="sticky top-0 z-30 -mb-2 bg-background pb-2">
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
      </div>

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
          onMemoSave={handleStagingMemo}
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
          loadingMore={txnLoadingMore}
          summary={txnSummary}
          loading={txnLoading}
          filterQ={filterQ}
          filterAccountId={filterAccountId}
          filterCategoryId={filterCategoryId}
          filterDirection={filterDirection}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          catBannerActive={catBannerActive}
          filterCatLabel={filterCatLabel}
          filterUncategorized={filterUncategorized}
          filterExcludeTransfer={filterExcludeTransfer}
          onClearCategoryBanner={clearCategoryBanner}
          onClearExcludeTransfer={clearExcludeTransfer}
          onClearDates={clearDates}
          accounts={accounts}
          leafTargets={leafTargets}
          categoryTree={categoryTree}
          reloadCategories={loadCategories}
          onFilterQChange={setFilterQ}
          onFilterAccountIdChange={setFilterAccountId}
          onFilterCategoryIdChange={setFilterCategoryId}
          onFilterDirectionChange={setFilterDirection}
          onSearch={handleTxnSearch}
          onLoadMore={handleTxnLoadMore}
          sort={txnSort}
          onSort={handleTxnSort}
          onClassify={handleTxnClassify}
          onMemoSave={handleTxnMemo}
          onBulkClassify={handleTxnBulkClassify}
          onBulkDelete={handleTxnBulkDelete}
          onBulkLinkLiability={handleTxnBulkLinkLiability}
        />
      </TabsContent>

      {/* ── 커밋 확인 다이얼로그 ── */}
      <Dialog open={commitDialogOpen} onOpenChange={setCommitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>저장 처리 확인</DialogTitle>
            <DialogDescription>
              분류완료 건만 확정 거래로 저장합니다. 미분류·검토 행은 보류되고, 중복 제외(중복 탭)
              행은 자동 정리됩니다.
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

      {/* ── 분류 확인(규칙 저장 여부 + 메모) — 스테이징 전용 ── */}
      {classifyConfirm && (
        <ClassifyConfirmDialog
          key={`${classifyConfirm.rowId}:${classifyConfirm.categoryId}`}
          categoryLabel={classifyConfirm.categoryLabel}
          initialMemo={classifyConfirm.memo}
          saving={classifySaving}
          onCancel={() => setClassifyConfirm(null)}
          onApply={handleClassifyConfirmApply}
        />
      )}

      {/* ── 동일 적요 자동 적용 확인 ── */}
      <Dialog open={autoApply !== null} onOpenChange={(open) => !open && setAutoApply(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>동일 적요 자동 적용</DialogTitle>
            <DialogDescription>
              같은 적요·같은 방향의 미처리 내역{' '}
              <strong>{autoApply?.siblingIds.length ?? 0}건</strong>에도 같은 계정과목을 적용할까요?
              (검토 제안도 덮어씁니다.)
              {autoApply?.memo != null && ' 메모도 함께 적용됩니다.'}
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
  onMemoSave,
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
  onMemoSave: (rowId: string, memo: string | null) => Promise<void>
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
      {/* 하위 탭 — 상단 메인 탭(높이 44px) 바로 아래 고정 */}
      <div className="sticky top-11 z-20 flex items-center gap-1.5 border-b bg-background pb-2">
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
                <TableHead className="w-28 text-right">거래후잔액</TableHead>
                <TableHead className="w-44">계정과목</TableHead>
                <TableHead className="w-24">상태</TableHead>
                <TableHead className="w-28">중복 처리</TableHead>
                <TableHead className="w-40">메모</TableHead>
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
                  onMemoSave={onMemoSave}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 하단 저장 처리 버튼 — 스크롤 위치와 무관하게 접근 가능하도록 하단 고정 */}
      <div className="sticky bottom-0 z-20 -mx-1 flex items-center justify-between border-t bg-background px-1 py-2">
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
        blockType={uniformBlockType(rows, selectedIds)}
        onClassify={runBulkClassify}
        onResolution={runBulkResolution}
        onClear={clearSelection}
      />
    </div>
  )
}

// ─── 다중 선택 일괄 처리 바 ────────────────────────────────────────────────────

/**
 * 선택 행의 금액 방향이 하나로 일치할 때만 어긋난 타입을 막는다(OUT→수익 차단, IN→비용 차단).
 * 방향이 섞였거나 선택이 없으면 null(제한 없음) — 일괄 분류는 혼합 선택을 허용하므로 과도 차단 방지.
 */
function uniformBlockType(
  rows: { id: string; direction: 'IN' | 'OUT' }[],
  selectedIds: Set<string>
): FinCategoryType | null {
  let dir: 'IN' | 'OUT' | null = null
  for (const r of rows) {
    if (!selectedIds.has(r.id)) continue
    if (dir === null) dir = r.direction
    else if (dir !== r.direction) return null
  }
  if (dir === null) return null
  return dir === 'OUT' ? 'INCOME' : 'EXPENSE'
}

function StagingBulkBar({
  selectedCount,
  leafTargets,
  blockType,
  onClassify,
  onResolution,
  onClear,
}: {
  selectedCount: number
  leafTargets: ComboOption[]
  blockType: FinCategoryType | null
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
              groupByType
              defaultType={blockType === 'INCOME' ? 'EXPENSE' : 'INCOME'}
              blockType={blockType}
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
            onClick={() => void run(() => onResolution('DUP_OVERWRITE'))}
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
  onMemoSave,
}: {
  row: StagedRow
  selected: boolean
  onToggleSelect: () => void
  leafTargets: ComboOption[]
  categoryTree: CategoryNode[]
  reloadCategories: () => Promise<void>
  onClassify: (rowId: string, categoryId: string) => void
  onDupResolution: (rowId: string, resolution: FinStagedResolution) => void
  onMemoSave: (rowId: string, memo: string | null) => Promise<void>
}) {
  const isDup =
    row.resolution === 'DUP_SAME' ||
    row.resolution === 'DUP_CHANGED' ||
    row.resolution === 'DUP_OVERWRITE'
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

      {/* 거래후잔액 (은행 임포트만 존재, 없으면 —) */}
      <TableCell className="text-right font-mono text-xs text-muted-foreground">
        {row.balanceAfter != null ? formatWon(row.balanceAfter) : '—'}
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
              direction={row.direction}
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
                onClick={() => onDupResolution(row.id, 'DUP_OVERWRITE')}
                className="h-6 px-2 text-xs"
              >
                유지
              </Button>
            ) : (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => onDupResolution(row.id, 'DUP_OVERWRITE')}
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

      {/* 메모 */}
      <TableCell>
        <MemoCell memo={row.memo} onSave={(m) => onMemoSave(row.id, m)} />
      </TableCell>
    </TableRow>
  )
}

// ─── 전체 거래 패널 ───────────────────────────────────────────────────────────

// ─── 정렬 가능한 컬럼 헤더 ─────────────────────────────────────────────────────

function SortHeader({
  label,
  field,
  sort,
  onSort,
  className,
  align = 'left',
}: {
  label: string
  field: TxnSortField
  sort: { field: TxnSortField; order: 'asc' | 'desc' }
  onSort: (field: TxnSortField) => void
  className?: string
  align?: 'left' | 'right'
}) {
  const active = sort.field === field
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex w-full items-center gap-1 hover:text-foreground ${
          align === 'right' ? 'justify-end' : ''
        }`}
        aria-label={`${label} 정렬`}
      >
        <span>{label}</span>
        {active ? (
          sort.order === 'asc' ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ChevronsUpDown className="size-3 text-muted-foreground/40" />
        )}
      </button>
    </TableHead>
  )
}

function TransactionsPanel({
  rows,
  total,
  loadingMore,
  summary,
  loading,
  filterQ,
  filterAccountId,
  filterCategoryId,
  filterDirection,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  catBannerActive,
  filterCatLabel,
  filterUncategorized,
  filterExcludeTransfer,
  onClearCategoryBanner,
  onClearExcludeTransfer,
  onClearDates,
  accounts,
  leafTargets,
  categoryTree,
  reloadCategories,
  onFilterQChange,
  onFilterAccountIdChange,
  onFilterCategoryIdChange,
  onFilterDirectionChange,
  onSearch,
  onLoadMore,
  sort,
  onSort,
  onClassify,
  onMemoSave,
  onBulkClassify,
  onBulkDelete,
  onBulkLinkLiability,
}: {
  rows: Transaction[]
  total: number
  loadingMore: boolean
  summary: TransactionSummary
  loading: boolean
  filterQ: string
  filterAccountId: string
  filterCategoryId: string
  filterDirection: 'all' | 'IN' | 'OUT'
  dateFrom: string
  dateTo: string
  onDateFromChange: (v: string) => void
  onDateToChange: (v: string) => void
  catBannerActive: boolean
  filterCatLabel: string | null
  filterUncategorized: boolean
  filterExcludeTransfer: boolean
  onClearCategoryBanner: () => void
  onClearExcludeTransfer: () => void
  onClearDates: () => void
  sort: { field: TxnSortField; order: 'asc' | 'desc' }
  onSort: (field: TxnSortField) => void
  accounts: {
    id: string
    name: string
    kind: FinAccountKind
    institution: string | null
    accountNumber: string | null
  }[]
  leafTargets: ComboOption[]
  categoryTree: CategoryNode[]
  reloadCategories: () => Promise<void>
  onFilterQChange: (v: string) => void
  onFilterAccountIdChange: (v: string) => void
  onFilterCategoryIdChange: (v: string) => void
  onFilterDirectionChange: (v: 'all' | 'IN' | 'OUT') => void
  onSearch: () => void
  onLoadMore: () => void
  onClassify: (txnId: string, categoryId: string) => void
  onMemoSave: (txnId: string, memo: string | null) => Promise<void>
  onBulkClassify: (ids: string[], categoryId: string) => Promise<void>
  onBulkDelete: (ids: string[]) => Promise<void>
  onBulkLinkLiability: (ids: string[], liabilityId: string | null) => Promise<void>
}) {
  // 다중 선택 — selectedInView가 현재 행으로 스코프하므로 필터/조회 후 자연히 정리된다.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
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
    if (deleting) return
    setDeleting(true)
    try {
      await onBulkDelete(selectedInView)
      setDeleteOpen(false)
      clearSelection()
    } finally {
      setDeleting(false)
    }
  }
  const runBulkLinkLiability = async (liabilityId: string | null) => {
    await onBulkLinkLiability(selectedInView, liabilityId)
    clearSelection()
  }
  const handleUnlinkLiability = async (txnId: string) => {
    await onBulkLinkLiability([txnId], null)
  }

  // 부채 목록 — 연결 드롭다운용 (첫 렌더 시 로드)
  const [liabilities, setLiabilities] = useState<{ id: string; name: string }[]>([])
  const [liabilitiesLoaded, setLiabilitiesLoaded] = useState(false)

  async function loadLiabilities() {
    if (liabilitiesLoaded) return
    try {
      const res = await fetch('/api/finance/liabilities')
      if (!res.ok) return
      const data = (await res.json()) as { liabilities: { id: string; name: string }[] }
      setLiabilities(data.liabilities ?? [])
    } catch {
      // 조용히 실패
    } finally {
      setLiabilitiesLoaded(true)
    }
  }

  return (
    <div className="space-y-3">
      {/* 현금흐름 딥링크 필터 배너 — 다중/미분류 계정과목·이체 제외(단일 콤보에 안 들어가는 조건) */}
      {(catBannerActive || filterExcludeTransfer) && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">현금흐름 필터</span>
          {catBannerActive && (
            <Badge variant="secondary" className="h-6 gap-1 pr-1 font-normal">
              <span className="text-muted-foreground">계정과목</span>
              {filterCatLabel ?? (filterUncategorized ? '미분류' : '다중')}
              <button
                type="button"
                onClick={onClearCategoryBanner}
                aria-label="계정과목 필터 해제"
                className="ml-0.5 rounded-sm text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </Badge>
          )}
          {filterExcludeTransfer && (
            <Badge variant="secondary" className="h-6 gap-1 pr-1 font-normal">
              이체 제외
              <button
                type="button"
                onClick={onClearExcludeTransfer}
                aria-label="이체 제외 해제"
                className="ml-0.5 rounded-sm text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </Badge>
          )}
        </div>
      )}
      {/* 필터 바 — 각 컨트롤 앞에 필드 라벨을 붙여 무엇을 거르는지 명시 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Input
          value={filterQ}
          onChange={(e) => onFilterQChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearch()
          }}
          placeholder="적요 · 가맹점 검색"
          className="h-8 max-w-52 text-xs"
        />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">기간</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearch()
            }}
            className="h-8 w-36 text-xs"
            aria-label="시작일"
          />
          <span className="text-xs text-muted-foreground">~</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearch()
            }}
            className="h-8 w-36 text-xs"
            aria-label="종료일"
          />
          {(dateFrom || dateTo) && (
            <Button
              size="icon"
              variant="ghost"
              onClick={onClearDates}
              className="h-8 w-8 shrink-0 text-muted-foreground"
              aria-label="기간 필터 해제"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
        {accounts.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">계좌</span>
            <Select
              value={filterAccountId || 'all'}
              onValueChange={(v) => onFilterAccountIdChange(v === 'all' ? '' : v)}
            >
              <SelectTrigger className="h-8 w-52 text-xs">
                <SelectValue placeholder="전체 계좌" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 계좌</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="text-xs">
                    <span className="flex items-center gap-1.5">
                      {[a.institution, a.name].filter(Boolean).join(' ')}
                      {a.accountNumber && (
                        <span className="text-muted-foreground">· {a.accountNumber}</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">계정과목</span>
          <CategoryCombobox
            options={leafTargets}
            value={filterCategoryId || null}
            onChange={onFilterCategoryIdChange}
            groupByType
            defaultType="EXPENSE"
            placeholder={catBannerActive ? '배너 필터 적용 중' : '전체 계정과목'}
            searchPlaceholder="계정과목 검색..."
            triggerClassName="h-8 w-44 text-xs"
            disabled={catBannerActive}
          />
          {filterCategoryId && !catBannerActive && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onFilterCategoryIdChange('')}
              className="h-8 w-8 shrink-0 text-muted-foreground"
              aria-label="계정과목 필터 해제"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">방향</span>
          <Select
            value={filterDirection}
            onValueChange={(v) => onFilterDirectionChange(v as 'all' | 'IN' | 'OUT')}
          >
            <SelectTrigger className="h-8 w-24 text-xs">
              <SelectValue placeholder="전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="IN">수입</SelectItem>
              <SelectItem value="OUT">지출</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
                <SortHeader
                  label="날짜"
                  field="txnDate"
                  sort={sort}
                  onSort={onSort}
                  className="w-24"
                />
                <SortHeader
                  label="출처"
                  field="account"
                  sort={sort}
                  onSort={onSort}
                  className="w-28"
                />
                <SortHeader label="적요" field="description" sort={sort} onSort={onSort} />
                <SortHeader
                  label="금액"
                  field="amount"
                  sort={sort}
                  onSort={onSort}
                  className="w-28"
                  align="right"
                />
                <SortHeader
                  label="거래후잔액"
                  field="balanceAfter"
                  sort={sort}
                  onSort={onSort}
                  className="w-28"
                  align="right"
                />
                <SortHeader
                  label="계정과목"
                  field="category"
                  sort={sort}
                  onSort={onSort}
                  className="w-44"
                />
                <SortHeader
                  label="상태"
                  field="classStatus"
                  sort={sort}
                  onSort={onSort}
                  className="w-24"
                />
                <TableHead className="w-40">메모</TableHead>
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
                  onMemoSave={onMemoSave}
                  onUnlinkLiability={handleUnlinkLiability}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 더 보기 — 로드된 행 수 < 전체 건수일 때 */}
      {rows.length > 0 && rows.length < total && (
        <div className="flex items-center justify-center gap-3 py-2 text-xs text-muted-foreground">
          <span>
            전체 {total.toLocaleString('ko-KR')}건 중 {rows.length.toLocaleString('ko-KR')}건 표시
            중
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? '불러오는 중...' : '더 보기'}
          </Button>
        </div>
      )}

      {/* 다중 선택 일괄 처리 바 — 계정과목 분류 / 부채 연결 / 삭제 */}
      <TransactionsBulkBar
        selectedCount={selectedInView.length}
        leafTargets={leafTargets}
        blockType={uniformBlockType(rows, selectedIds)}
        liabilities={liabilities}
        onClassify={runBulkClassify}
        onLinkLiability={runBulkLinkLiability}
        onLoadLiabilities={loadLiabilities}
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
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              취소
            </Button>
            <Button variant="destructive" onClick={() => void runBulkDelete()} disabled={deleting}>
              {deleting ? '삭제 중...' : `${selectedInView.length}건 삭제`}
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
  blockType,
  liabilities,
  onClassify,
  onLinkLiability,
  onLoadLiabilities,
  onDeleteRequest,
  onClear,
}: {
  selectedCount: number
  leafTargets: ComboOption[]
  blockType: FinCategoryType | null
  liabilities: { id: string; name: string }[]
  onClassify: (categoryId: string) => Promise<void>
  onLinkLiability: (liabilityId: string | null) => Promise<void>
  onLoadLiabilities: () => Promise<void>
  onDeleteRequest: () => void
  onClear: () => void
}) {
  const [busy, setBusy] = useState(false)
  // 상환 연결 Select는 "액션 트리거"라 선택 후 플레이스홀더로 복귀해야 함.
  // Radix SelectItem이 빈 문자열 value를 허용하지 않으므로 센티넬 사용.
  const LINK_PLACEHOLDER = '__lp__'
  const [linkSelectVal, setLinkSelectVal] = useState(LINK_PLACEHOLDER)
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
              groupByType
              defaultType={blockType === 'INCOME' ? 'EXPENSE' : 'INCOME'}
              blockType={blockType}
            />
          </div>
          {/* 부채 상환 연결 */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-background/70">상환 연결</span>
            <Select
              value={linkSelectVal}
              onValueChange={(v) => {
                if (!v || v === LINK_PLACEHOLDER) return
                setLinkSelectVal(LINK_PLACEHOLDER) // 선택 후 플레이스홀더로 복귀
                void run(() => onLinkLiability(v === '__unlink__' ? null : v))
              }}
              onOpenChange={(open) => {
                if (open) void onLoadLiabilities()
              }}
            >
              <SelectTrigger
                className="h-8 w-40 border-background/20 bg-background/10 text-xs text-background"
                disabled={busy}
              >
                <SelectValue placeholder="부채 선택" />
              </SelectTrigger>
              <SelectContent>
                {liabilities.length === 0 ? (
                  <SelectItem value="__empty__" disabled>
                    등록된 부채 없음
                  </SelectItem>
                ) : (
                  liabilities.map((lb) => (
                    <SelectItem key={lb.id} value={lb.id} className="text-xs">
                      {lb.name}
                    </SelectItem>
                  ))
                )}
                <SelectItem value="__unlink__" className="text-xs text-muted-foreground">
                  연결 해제
                </SelectItem>
              </SelectContent>
            </Select>
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
  onMemoSave,
  onUnlinkLiability,
}: {
  txn: Transaction
  selected: boolean
  onToggleSelect: () => void
  leafTargets: ComboOption[]
  categoryTree: CategoryNode[]
  reloadCategories: () => Promise<void>
  onClassify: (txnId: string, categoryId: string) => void
  onMemoSave: (txnId: string, memo: string | null) => Promise<void>
  onUnlinkLiability: (txnId: string) => Promise<void>
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

      {/* 적요 + 부채 연결 배지 */}
      <TableCell>
        <span className="block max-w-[280px] truncate text-xs" title={txn.description ?? ''}>
          {txn.description ?? txn.counterparty ?? '-'}
        </span>
        {txn.liability && (
          <span className="mt-0.5 inline-flex items-center gap-0.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-0 text-[10px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            상환→{txn.liability.name}
            <button
              type="button"
              onClick={() => void onUnlinkLiability(txn.id)}
              aria-label="부채 연결 해제"
              className="ml-0.5 rounded-full hover:bg-red-100 dark:hover:bg-red-900"
            >
              <X className="size-2.5" />
            </button>
          </span>
        )}
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

      {/* 거래후잔액 (은행 임포트만 존재, 없으면 —) */}
      <TableCell className="text-right font-mono text-xs text-muted-foreground">
        {txn.balanceAfter != null ? formatWon(txn.balanceAfter) : '—'}
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
            direction={txn.direction}
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

      {/* 메모 */}
      <TableCell>
        <MemoCell memo={txn.memo} onSave={(m) => onMemoSave(txn.id, m)} />
      </TableCell>
    </TableRow>
  )
}

// ─── 분류 확인 팝업 (스테이징 전용) ─────────────────────────────────────────────

/**
 * 계정과목 선택 직후 확인 팝업. 규칙 저장 체크(기본 on — 동일 적요 자동 분류·메모 포함)와
 * 메모 입력(행 기존 메모 prefill)을 받아 적용한다. 체크 해제 시 규칙 미학습, 분류+메모만 반영.
 * key로 rowId:categoryId를 받아 열 때마다 상태가 초기화된다.
 */
function ClassifyConfirmDialog({
  categoryLabel,
  initialMemo,
  saving,
  onCancel,
  onApply,
}: {
  categoryLabel: string
  initialMemo: string | null
  saving: boolean
  onCancel: () => void
  onApply: (learn: boolean, memo: string) => void
}) {
  const [learn, setLearn] = useState(true)
  const [memoDraft, setMemoDraft] = useState(initialMemo ?? '')

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>계정과목 분류</DialogTitle>
          <DialogDescription>
            이 거래를 <strong>{categoryLabel}</strong>(으)로 분류합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={learn}
              onCheckedChange={(v) => setLearn(v === true)}
              className="mt-0.5"
            />
            <span>
              이 분류를 규칙으로 저장
              <span className="block text-xs text-muted-foreground">
                동일 적요는 다음 업로드부터 자동 분류되고, 메모도 함께 적용됩니다
              </span>
            </span>
          </label>
          <div className="space-y-1">
            <Label className="text-xs">메모</Label>
            <Textarea
              value={memoDraft}
              onChange={(e) => setMemoDraft(e.target.value)}
              maxLength={MEMO_MAX}
              rows={2}
              placeholder="메모 입력 (선택)"
              className="text-xs"
            />
            <p className="text-right text-[10px] text-muted-foreground">
              {memoDraft.length}/{MEMO_MAX}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            취소
          </Button>
          <Button onClick={() => onApply(learn, memoDraft)} disabled={saving}>
            {saving ? '저장 중...' : '적용'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── 메모 셀 (스테이징·확정 공용) ───────────────────────────────────────────────

/**
 * 인라인 메모 입력 셀. 항상 소형 input을 표시하고 blur/Enter 시 변경분만 저장한다.
 * trim 후 빈 문자열이면 삭제(null). 스테이징 메모는 저장 처리 시 확정 거래로 이관된다.
 */
function MemoCell({
  memo,
  onSave,
}: {
  memo: string | null
  onSave: (memo: string | null) => Promise<void>
}) {
  const [draft, setDraft] = useState(memo ?? '')
  const [saving, setSaving] = useState(false)

  // 외부 갱신(분류 팝업·자동 적용 후 재조회 등) 동기화
  useEffect(() => setDraft(memo ?? ''), [memo])

  const commit = async () => {
    const value = draft.trim() === '' ? null : draft.trim()
    if (value === memo) return // 변경분만 저장
    setSaving(true)
    try {
      await onSave(value)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '메모 저장 실패')
      setDraft(memo ?? '')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      maxLength={MEMO_MAX}
      disabled={saving}
      placeholder="메모"
      aria-label="메모"
      title={memo ?? undefined}
      className="h-7 w-[150px] text-xs"
    />
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
  direction,
}: {
  value: string | null
  options: ComboOption[]
  categoryTree: CategoryNode[]
  reloadCategories: () => Promise<void>
  onSelect: (categoryId: string) => void
  /** 금액 방향 — 드롭다운 기본 탭(IN→수익, OUT→비용)을 정해 빠르게 찾게 한다. */
  direction: 'IN' | 'OUT'
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
        groupByType
        defaultType={direction === 'IN' ? 'INCOME' : 'EXPENSE'}
        blockType={direction === 'IN' ? 'EXPENSE' : 'INCOME'}
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

  // AI가 있으면 AI 우선, 없으면 룰 자동 표시. (AI 칩의 ✕는 setAiSuggestion(null)로 룰/버튼 복귀)
  const active: (SuggestionData & { source: SuggestSource }) | null = aiSuggestion
    ? { source: 'ai', ...aiSuggestion }
    : ruleSuggestion
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
        {/* AI 추천 칩만 닫기 노출 — AI 결과를 취소하고 룰 추천/‘AI 추천’ 버튼으로 복귀. */}
        {isAi && (
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => setAiSuggestion(null)}
            aria-label="AI 추천 취소"
          >
            ✕
          </button>
        )}
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

