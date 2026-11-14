'use client'

import { createApplicantSearch } from '@/lib/hiring/application-search-action'
import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import {
  FloatingActionBar,
  floatingActionButtonClass,
  floatingActionSelectTriggerClass,
} from '@/components/ui/floating-action-bar'
import { applyRangeSelection } from '@/lib/range-selection'
import { RECRUITING_APPLICATIONS_PATH, getRecruitingApplicationPath } from '@/lib/deck-routes'
import { STAGE_LABELS, PROCESS_STAGE_LABELS } from '@/lib/hiring/application-shared'
import { APPLICATION_STAGES } from '@/lib/validations/hiring-applicants'
import type { ApplicationListRow } from '@/lib/hiring/application-shared'
import type { ApplicationStatusCounts } from '@/lib/hiring/applications'
import { cn } from '@/lib/utils'
import type { HiringApplicationStage } from '@/generated/prisma/client'
import {
  StageBadge,
  ProcessStageBadge,
  DuplicatedBadge,
  DirectRegistrationBadge,
  BlacklistBadge,
} from '@/components/hiring-applicants/badges'

type Props = {
  canExportExcel: boolean
  rows: ApplicationListRow[]
  total: number
  pageSize: number
  page: number
  postings: Array<{ id: string; title: string }>
  counts: ApplicationStatusCounts
  // 이동 기준 경로(쿼리 제외). 생략하면 지원자 목록 경로 — 공고 상세 탭에서 재사용할 때 지정한다.
  basePath?: string
  // basePath 에 항상 붙는 쿼리(예: tab=applicants)
  baseQuery?: Record<string, string>
  // 지정하면 공고 필터를 숨기고 해당 공고로 고정한다(filters.posting 도 같은 값이어야 한다).
  lockedPostingId?: string
  filters: {
    search?: string
    posting: string
    stage: string
    process: string
    from: string
    to: string
    store: string
    position: string
  }
}

const ALL = '__all__'
const SEARCH_DEBOUNCE_MS = 400

// 상태 탭 — 진행 중 세부 단계는 stage=HIRING + process, 합격/불합격은 stage 만 지정한다.
const STATUS_TABS: Array<{
  key: keyof ApplicationStatusCounts
  label: string
  stage: string
  process: string
}> = [
  { key: 'all', label: '전체', stage: '', process: '' },
  { key: 'APPLIED', label: PROCESS_STAGE_LABELS.APPLIED, stage: 'HIRING', process: 'APPLIED' },
  {
    key: 'INTERVIEW',
    label: PROCESS_STAGE_LABELS.INTERVIEW,
    stage: 'HIRING',
    process: 'INTERVIEW',
  },
  {
    key: 'JOB_OFFER',
    label: PROCESS_STAGE_LABELS.JOB_OFFER,
    stage: 'HIRING',
    process: 'JOB_OFFER',
  },
  { key: 'ACCEPTED', label: STAGE_LABELS.ACCEPTED, stage: 'ACCEPTED', process: '' },
  { key: 'REJECTED', label: STAGE_LABELS.REJECTED, stage: 'REJECTED', process: '' },
]

export function ApplicationsTable(props: Props) {
  const [storeInput, setStoreInput] = useState(props.filters.store)
  const [positionInput, setPositionInput] = useState(props.filters.position)
  // 검색어는 URL 변경(리마운트)에도 입력 중인 값을 유지해야 하므로 바깥에서 보관한다.
  const [searchText, setSearchText] = useState('')
  const lastAppliedSearch = useRef('')
  const { filters, page } = props
  return (
    <ApplicationsTableContent
      key={JSON.stringify([
        filters.search,
        filters.posting,
        filters.stage,
        filters.process,
        filters.from,
        filters.to,
        filters.store,
        filters.position,
        page,
      ])}
      {...props}
      storeInput={storeInput}
      setStoreInput={setStoreInput}
      positionInput={positionInput}
      setPositionInput={setPositionInput}
      searchText={searchText}
      setSearchText={setSearchText}
      lastAppliedSearch={lastAppliedSearch}
    />
  )
}

function ApplicationsTableContent({
  canExportExcel,
  rows,
  total,
  pageSize,
  page,
  postings,
  counts,
  basePath = RECRUITING_APPLICATIONS_PATH,
  baseQuery,
  lockedPostingId,
  filters,
  storeInput,
  setStoreInput,
  positionInput,
  setPositionInput,
  searchText,
  setSearchText,
  lastAppliedSearch,
}: Props & {
  searchText: string
  setSearchText: (value: string) => void
  lastAppliedSearch: { current: string }
  storeInput: string
  setStoreInput: (value: string) => void
  positionInput: string
  setPositionInput: (value: string) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStage, setBulkStage] = useState<HiringApplicationStage | ''>('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const lastIndex = useRef<number | null>(null)
  const bulkInFlight = useRef(false)
  const exportInFlight = useRef(false)
  const [searching, setSearching] = useState(false)
  const searchInFlight = useRef(false)
  const busy = bulkLoading || pending || searching

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const allKeys = rows.map((r) => r.id)
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k))
  const someSelected = !allSelected && allKeys.some((k) => selected.has(k))

  function updateQuery(patch: Record<string, string>) {
    if (bulkInFlight.current || pending) return
    lastIndex.current = null
    const params = new URLSearchParams(baseQuery)
    const next = { ...filters, page: '1', ...patch }
    if (next.search) params.set('search', next.search)
    if (next.posting) params.set('posting', next.posting)
    if (next.stage) params.set('stage', next.stage)
    if (next.stage === 'HIRING' && next.process) params.set('process', next.process)
    if (next.from) params.set('from', next.from)
    if (next.to) params.set('to', next.to)
    if (next.store) params.set('store', next.store)
    if (next.position) params.set('position', next.position)
    if (next.page && next.page !== '1') params.set('page', next.page)
    startTransition(() => {
      router.push(`${basePath}?${params.toString()}`)
      setSelected(new Set())
    })
  }

  function toggleRow(id: string, index: number, shiftKey: boolean) {
    if (bulkInFlight.current || pending) return
    setSelected((prev) =>
      applyRangeSelection(prev, allKeys, id, index, shiftKey, lastIndex.current)
    )
    lastIndex.current = index
  }

  async function runBulkStage() {
    if (bulkInFlight.current || pending || !bulkStage || selected.size === 0) return
    bulkInFlight.current = true
    setBulkLoading(true)
    try {
      const res = await fetch('/api/hiring-applicants/applications/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), stage: bulkStage }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message ?? '일괄 변경 실패')
      }
      const { updated } = await res.json()
      if (!Number.isInteger(updated) || updated < 0 || updated > selected.size) {
        throw new Error('변경 결과를 확인하지 못했습니다. 목록을 새로고침해 확인해 주세요')
      }
      if (updated === selected.size) {
        toast.success(`${updated}건을 '${STAGE_LABELS[bulkStage]}'(으)로 변경했습니다`)
      } else {
        toast.warning(
          `${selected.size}건 중 ${updated}건을 변경했습니다. 나머지는 삭제되었거나 접근할 수 없습니다`
        )
      }
      setSelected(new Set())
      setBulkStage('')
      startTransition(() => router.refresh())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '일괄 변경 실패')
    } finally {
      bulkInFlight.current = false
      setBulkLoading(false)
    }
  }

  // 검색어(이름·휴대폰 끝 4자리)를 서버 액션으로 토큰화해 URL 에 반영한다.
  // extra 로 근무지·직무 조건을 함께 적용할 수 있다(Enter 제출).
  async function applySearch(text: string, extra: Record<string, string> = {}) {
    if (searchInFlight.current) return
    const previous = lastAppliedSearch.current
    lastAppliedSearch.current = text
    searchInFlight.current = true
    setSearching(true)
    try {
      const search = await createApplicantSearch(text)
      updateQuery({ search, ...extra })
    } catch {
      lastAppliedSearch.current = previous
      toast.error('검색하지 못했습니다. 입력과 로그인 상태를 확인해 주세요')
    } finally {
      searchInFlight.current = false
      setSearching(false)
    }
  }

  // 입력 후 400ms 지나면 자동 적용(디바운스). 이미 적용한 값·처리 중에는 건너뛴다.
  useEffect(() => {
    if (searchText === lastAppliedSearch.current || busy) return
    const timer = setTimeout(() => void applySearch(searchText), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applySearch 는 매 렌더 새로 만들어지지만 ref 만 참조한다
  }, [searchText, busy])

  async function exportExcel() {
    if (exportInFlight.current || busy) return
    exportInFlight.current = true
    setExporting(true)
    const params = new URLSearchParams()
    if (filters.search) params.set('search', filters.search)
    if (filters.posting) params.set('posting', filters.posting)
    if (filters.stage) params.set('stage', filters.stage)
    if (filters.stage === 'HIRING' && filters.process) params.set('process', filters.process)
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
    if (filters.store) params.set('store', filters.store)
    if (filters.position) params.set('position', filters.position)
    try {
      const res = await fetch(`/api/hiring-applicants/applications/export?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message ?? '엑셀 내보내기에 실패했습니다')
      }
      if (
        !res.headers
          .get('Content-Type')
          ?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      ) {
        throw new Error('엑셀 파일을 받지 못했습니다. 로그인 상태를 확인하고 다시 시도해 주세요')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download =
        res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ??
        'applicants.xlsx'
      document.body.appendChild(link)
      try {
        link.click()
      } finally {
        link.remove()
        // 브라우저가 다운로드를 시작할 시간을 준 뒤 메모리를 해제한다.
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '엑셀 내보내기에 실패했습니다')
    } finally {
      exportInFlight.current = false
      setExporting(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* 검색·조건 — 어느 입력에서든 Enter 로 함께 적용한다(검색어는 400ms 디바운스도 적용) */}
      <form
        role="search"
        aria-label="지원자 검색"
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void applySearch(searchText, {
            store: storeInput.trim(),
            position: positionInput.trim(),
          })
        }}
      >
        <Input
          aria-label="지원자 이름 또는 휴대전화 검색"
          placeholder="이름 · 휴대폰 끝 4자리"
          maxLength={200}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          className="w-full sm:w-64"
        />
        <Input
          aria-label="지원 근무지"
          placeholder="지원 근무지"
          maxLength={200}
          className="w-full sm:w-40"
          value={storeInput}
          onChange={(event) => setStoreInput(event.target.value)}
        />
        <Input
          aria-label="지원 직무"
          placeholder="지원 직무"
          maxLength={200}
          className="w-full sm:w-40"
          value={positionInput}
          onChange={(event) => setPositionInput(event.target.value)}
        />
        {/* Enter 암묵 제출용 — 입력이 여러 개라 제출 버튼이 있어야 한다 */}
        <button type="submit" className="sr-only">
          검색 적용
        </button>
        {filters.search && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setSearchText('')
              lastAppliedSearch.current = ''
              updateQuery({ search: '' })
            }}
          >
            검색 해제
          </Button>
        )}
        {(filters.store || filters.position) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setStoreInput('')
              setPositionInput('')
              updateQuery({ store: '', position: '' })
            }}
          >
            조건 초기화
          </Button>
        )}
        {(storeInput.trim() !== filters.store || positionInput.trim() !== filters.position) && (
          <span className="text-xs text-muted-foreground">
            근무지·직무는 Enter 를 눌러야 적용됩니다.
          </span>
        )}
      </form>
      <nav aria-label="진행 상태" className="flex flex-wrap gap-1 border-b">
        {STATUS_TABS.map((tab) => {
          const active =
            filters.stage === tab.stage && (filters.process === tab.process || !tab.process)
          return (
            <button
              key={tab.key}
              type="button"
              aria-current={active ? 'page' : undefined}
              disabled={busy}
              onClick={() => updateQuery({ stage: tab.stage, process: tab.process })}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm transition-colors disabled:opacity-60',
                active
                  ? 'border-primary font-semibold text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}{' '}
              <span className="tabular-nums">{counts[tab.key].toLocaleString('ko-KR')}</span>
            </button>
          )
        })}
      </nav>
      {/* 필터 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          {!lockedPostingId && (
            <Select
              disabled={busy}
              value={filters.posting || ALL}
              onValueChange={(v) => updateQuery({ posting: v === ALL ? '' : v })}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="전체 공고" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>전체 공고</SelectItem>
                {postings.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center gap-1 text-sm">
            <Input
              type="date"
              disabled={busy}
              value={filters.from}
              onChange={(e) => updateQuery({ from: e.target.value })}
              className="w-32 sm:w-36"
            />
            <span className="text-muted-foreground">~</span>
            <Input
              type="date"
              disabled={busy}
              value={filters.to}
              onChange={(e) => updateQuery({ to: e.target.value })}
              className="w-32 sm:w-36"
            />
          </div>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <Button
            variant="outline"
            size="sm"
            onClick={exportExcel}
            disabled={!canExportExcel || exporting || busy}
            aria-describedby={canExportExcel ? undefined : 'excel-permission-note'}
          >
            {exporting ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : (
              <Download className="mr-1 size-4" />
            )}
            엑셀 내보내기
          </Button>
          {!canExportExcel && (
            <p id="excel-permission-note" className="text-xs text-muted-foreground">
              엑셀 내보내기는 관리자 이상만 이용할 수 있습니다.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-md border">
        <Table className="min-w-[760px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(v) => setSelected(v === true ? new Set(allKeys) : new Set())}
                  aria-label="전체 선택"
                  disabled={allKeys.length === 0 || busy}
                />
              </TableHead>
              {/* 공고 고정(공고 상세 탭)일 때는 공고 열을 숨기고 이름 열이 남는 폭을 쓴다 */}
              <TableHead className={lockedPostingId ? undefined : 'w-[140px]'}>이름</TableHead>
              {!lockedPostingId && <TableHead>공고</TableHead>}
              <TableHead className="w-[120px]">진행 상태</TableHead>
              <TableHead className="w-[150px]">확인 필요</TableHead>
              <TableHead className="w-[110px] text-right">지원일</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={lockedPostingId ? 5 : 6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {pending ? (
                    '불러오는 중...'
                  ) : page > totalPages ? (
                    <div className="space-y-2">
                      <p>요청한 페이지에 지원자가 없습니다</p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => updateQuery({ page: '1' })}
                      >
                        첫 페이지로 이동
                      </Button>
                    </div>
                  ) : (
                    '지원자가 없습니다'
                  )}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={(e) => {
                    // 이름 링크는 브라우저가 직접 처리하므로 행 클릭 이동과 겹치지 않게 한다.
                    if ((e.target as HTMLElement).closest('a')) return
                    if (!busy) router.push(getRecruitingApplicationPath(r.id))
                  }}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(r.id)}
                      disabled={busy}
                      onClick={(e: React.MouseEvent) => toggleRow(r.id, i, e.shiftKey)}
                      onCheckedChange={() => {}}
                      aria-label={`${r.maskedName} 선택`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={getRecruitingApplicationPath(r.id)}
                      className="block truncate hover:underline focus-visible:underline"
                    >
                      {r.maskedName}
                    </Link>
                  </TableCell>
                  {!lockedPostingId && (
                    <TableCell className="text-sm">
                      <div className="truncate" title={r.postingTitle}>
                        {r.postingTitle}
                      </div>
                    </TableCell>
                  )}
                  <TableCell>
                    {r.stage === 'HIRING' ? (
                      <ProcessStageBadge stage={r.hiringStage} />
                    ) : (
                      <StageBadge stage={r.stage} />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.duplicated && <DuplicatedBadge />}
                      {r.directRegistration && <DirectRegistrationBadge />}
                      {r.blacklisted && <BlacklistBadge />}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 페이지네이션 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>총 {total.toLocaleString('ko-KR')}건</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || busy}
            onClick={() => updateQuery({ page: String(page - 1) })}
          >
            이전
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || busy}
            onClick={() => updateQuery({ page: String(page + 1) })}
          >
            다음
          </Button>
        </div>
      </div>

      <FloatingActionBar
        open={selected.size > 0}
        onClear={() => setSelected(new Set())}
        clearDisabled={busy}
        actions={
          <>
            <Select
              disabled={busy}
              value={bulkStage}
              onValueChange={(v) => setBulkStage(v as HiringApplicationStage)}
            >
              <SelectTrigger className={`w-32 ${floatingActionSelectTriggerClass}`}>
                <SelectValue placeholder="상태 변경" />
              </SelectTrigger>
              <SelectContent>
                {APPLICATION_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={floatingActionButtonClass}
              onClick={runBulkStage}
              disabled={busy || !bulkStage}
            >
              {bulkLoading && <Loader2 className="mr-1 size-4 animate-spin" />}
              적용
            </Button>
          </>
        }
      >
        <span className="text-sm font-semibold">{selected.size}개 선택됨</span>
      </FloatingActionBar>
    </div>
  )
}
