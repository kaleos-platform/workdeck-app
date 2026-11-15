'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarPlus, Copy, Link2, Loader2, Lock, MoreHorizontal, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { closePosting } from './close-posting'
import { CloseConfirmDialog } from './close-confirm-dialog'
import { ExtendDeadlineDialog } from './extend-deadline-dialog'
import { canExtendDeadline } from './extend-posting'
import { NewPostingButton } from './new-posting-button'
import { JOB_TYPE_LABELS } from './build-types'
import { PostingStatusBadge, STATUS_LABELS, type PostingStatus } from './status-badge'
import {
  RECRUITING_DETAIL_TEMPLATES_PATH,
  RECRUITING_POSTINGS_PATH,
  getRecruitingPostingBuildPath,
  getHiringPublicApplyPath,
  getRecruitingPostingDetailPath,
  getRecruitingPostingPath,
} from '@/lib/deck-routes'

export type PostingRow = {
  id: string
  uuid: string
  title: string
  status: PostingStatus
  closingDate: string | null
  createdAt: string
  applicantCount: number
  receptionExpired: boolean
}

const STATUS_TABS: Array<{ value: 'ALL' | PostingStatus; label: string }> = [
  { value: 'ALL', label: '전체' },
  { value: 'DRAFT', label: STATUS_LABELS.DRAFT },
  { value: 'ACTIVE', label: STATUS_LABELS.ACTIVE },
  { value: 'CLOSED', label: STATUS_LABELS.CLOSED },
  { value: 'ARCHIVED', label: STATUS_LABELS.ARCHIVED },
]

function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function PostingsTable({
  postings,
  total,
  page,
  pageSize,
  q,
  status,
  store,
  position,
  jobType,
}: {
  postings: PostingRow[]
  total: number
  page: number
  pageSize: number
  q: string
  status: 'ALL' | PostingStatus
  store: string
  position: string
  jobType: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState(q)
  const [storeInput, setStoreInput] = useState(store)
  const [positionInput, setPositionInput] = useState(position)
  const [jobTypeInput, setJobTypeInput] = useState(jobType)
  const [pending, startTransition] = useTransition()
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  // 확인 팝업 대상 행(마감 확인·마감일 연장)
  const [closeTarget, setCloseTarget] = useState<PostingRow | null>(null)
  const [extendTarget, setExtendTarget] = useState<PostingRow | null>(null)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  // 마지막으로 이동한 조건 — 서버 값이 이것과 다를 때(뒤로가기 등)만 입력창을 맞춘다.
  const applied = useRef({ q, store, position, jobType })

  // 제목·장소·직무 입력은 400ms 멈추면 자동 적용(Enter는 즉시 적용)
  useEffect(() => {
    const next = { q: query.trim(), store: storeInput.trim(), position: positionInput.trim() }
    const cur = applied.current
    if (next.q === cur.q && next.store === cur.store && next.position === cur.position) return
    const timer = setTimeout(() => {
      navigate(1, next.q, status, { store: next.store, position: next.position, jobType })
    }, 400)
    return () => clearTimeout(timer)
    // navigate는 매 렌더 새로 만들어지므로 입력값 변경만 추적한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, storeInput, positionInput])

  // 뒤로가기 등 외부에서 URL 조건이 바뀌면 입력창을 따라간다.
  useEffect(() => {
    const cur = applied.current
    if (cur.q === q && cur.store === store && cur.position === position && cur.jobType === jobType)
      return
    applied.current = { q, store, position, jobType }
    setQuery(q)
    setStoreInput(store)
    setPositionInput(position)
    setJobTypeInput(jobType)
  }, [q, store, position, jobType])

  function navigate(
    nextPage: number,
    nextQuery = q,
    nextStatus = status,
    filters = { store, position, jobType }
  ) {
    const params = new URLSearchParams()
    if (nextQuery.trim()) params.set('q', nextQuery.trim())
    if (nextStatus !== 'ALL') params.set('status', nextStatus)
    if (filters.store.trim()) params.set('store', filters.store.trim())
    if (filters.position.trim()) params.set('position', filters.position.trim())
    if (filters.jobType) params.set('jobType', filters.jobType)
    if (nextPage > 1) params.set('page', String(nextPage))
    applied.current = {
      q: nextQuery.trim(),
      store: filters.store.trim(),
      position: filters.position.trim(),
      jobType: filters.jobType,
    }
    const suffix = params.toString()
    startTransition(() => router.push(`${RECRUITING_POSTINGS_PATH}${suffix ? `?${suffix}` : ''}`))
  }

  async function handleCopy(postingId: string) {
    setCopyingId(postingId)
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/copy`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('공고 복사에 실패했습니다')
      const { posting } = await res.json()
      toast.success('공고를 복사했습니다')
      router.push(getRecruitingPostingBuildPath(posting.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '공고 복사에 실패했습니다')
    } finally {
      setCopyingId(null)
    }
  }

  async function handleClose(postingId: string) {
    setClosingId(postingId)
    try {
      await closePosting(postingId)
      toast.success('공고를 마감했습니다')
      setCloseTarget(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '처리에 실패했습니다')
    } finally {
      setClosingId(null)
    }
  }

  function handleCopyApplyLink(uuid: string) {
    const url = `${window.location.origin}${getHiringPublicApplyPath(uuid)}`
    navigator.clipboard.writeText(url).then(
      () => toast.success('지원서 링크를 복사했습니다'),
      () => toast.error('복사에 실패했습니다')
    )
  }

  return (
    <div className="space-y-4" aria-busy={pending}>
      <form
        role="search"
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          navigate(1, query, status, {
            store: storeInput,
            position: positionInput,
            jobType: jobTypeInput,
          })
        }}
      >
        <Input
          className="w-full sm:w-48"
          aria-label="공고 제목 검색"
          placeholder="공고 제목 검색"
          maxLength={200}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Input
          className="w-full sm:w-40"
          aria-label="모집 장소"
          placeholder="모집 장소"
          maxLength={200}
          value={storeInput}
          onChange={(event) => setStoreInput(event.target.value)}
        />
        <Input
          className="w-full sm:w-40"
          aria-label="모집 직무"
          placeholder="모집 직무"
          maxLength={200}
          value={positionInput}
          onChange={(event) => setPositionInput(event.target.value)}
        />
        <select
          aria-label="고용 형태"
          disabled={pending}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-40"
          value={jobTypeInput}
          onChange={(event) => {
            const nextJobType = event.target.value
            setJobTypeInput(nextJobType)
            navigate(1, query, status, {
              store: storeInput,
              position: positionInput,
              jobType: nextJobType,
            })
          }}
        >
          <option value="">전체 고용 형태</option>
          {Object.entries(JOB_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {(q || status !== 'ALL' || store || position || jobType) && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setQuery('')
              setStoreInput('')
              setPositionInput('')
              setJobTypeInput('')
              navigate(1, '', 'ALL', { store: '', position: '', jobType: '' })
            }}
          >
            초기화
          </Button>
        )}
      </form>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Tabs value={status} onValueChange={(v) => navigate(1, q, v as 'ALL' | PostingStatus)}>
          <TabsList className="h-auto flex-wrap">
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} disabled={pending}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={RECRUITING_DETAIL_TEMPLATES_PATH}>공고 템플릿</Link>
          </Button>
          <NewPostingButton />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        상태 탭은 발행 상태 기준입니다. 마감일이 지난 공고는 접수가 중단되며, 목록을 새로고침해 접수
        상태를 확인할 수 있습니다.
      </p>

      <div className="rounded-lg border">
        <Table className="min-w-[668px] table-fixed sm:min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-20 w-[180px] bg-background sm:w-[272px]">
                제목
              </TableHead>
              <TableHead className="w-24">상태</TableHead>
              <TableHead className="w-24 text-right">지원자</TableHead>
              <TableHead className="w-32">마감일</TableHead>
              <TableHead className="w-32">작성일</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {postings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                  {page > totalPages
                    ? '요청한 페이지에 공고가 없습니다.'
                    : q || status !== 'ALL' || store || position || jobType
                      ? '조건에 맞는 공고가 없습니다.'
                      : '공고가 없습니다. 새 공고로 첫 공고를 만들어 보세요.'}
                  {page > 1 && (
                    <Button variant="link" disabled={pending} onClick={() => navigate(1)}>
                      첫 페이지로
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              postings.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={(e) => {
                    // 링크·버튼·메뉴 클릭은 각자 처리하므로 행 클릭 이동과 겹치지 않게 한다.
                    if ((e.target as HTMLElement).closest('a, button, [role="menuitem"]')) return
                    router.push(getRecruitingPostingDetailPath(p.id))
                  }}
                >
                  <TableCell className="sticky left-0 z-10 bg-background font-medium">
                    <Link
                      href={getRecruitingPostingDetailPath(p.id)}
                      className="block truncate hover:underline"
                      title={p.title}
                    >
                      {p.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <PostingStatusBadge status={p.status} />
                      {p.receptionExpired && (
                        <span className="text-xs font-semibold text-destructive">접수 마감</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Link
                      href={getRecruitingPostingPath(p.id, { tab: 'applicants' })}
                      className="hover:underline"
                      aria-label={`${p.title} 지원자 ${p.applicantCount}명 보기`}
                    >
                      {p.applicantCount}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(p.closingDate)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 rounded-md">
                          <MoreHorizontal className="size-4" />
                          <span className="sr-only">행 메뉴</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => router.push(getRecruitingPostingBuildPath(p.id))}
                        >
                          <Pencil className="size-4" />
                          수정
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={copyingId === p.id}
                          onSelect={() => handleCopy(p.id)}
                        >
                          {copyingId === p.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Copy className="size-4" />
                          )}
                          복사
                        </DropdownMenuItem>
                        {p.status === 'ACTIVE' && !p.receptionExpired && (
                          <DropdownMenuItem onSelect={() => handleCopyApplyLink(p.uuid)}>
                            <Link2 className="size-4" />
                            지원서 링크 복사
                          </DropdownMenuItem>
                        )}
                        {canExtendDeadline(p) && (
                          <DropdownMenuItem onSelect={() => setExtendTarget(p)}>
                            <CalendarPlus className="size-4" />
                            마감일 연장
                          </DropdownMenuItem>
                        )}
                        {p.status === 'ACTIVE' && (
                          <DropdownMenuItem
                            disabled={closingId === p.id}
                            onSelect={() => setCloseTarget(p)}
                          >
                            {closingId === p.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Lock className="size-4" />
                            )}
                            마감
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p role="status" className="text-muted-foreground">
          {pending
            ? '공고를 불러오는 중…'
            : `총 ${total.toLocaleString('ko-KR')}건 · ${page}페이지`}
        </p>
        <nav aria-label="공고 페이지 이동" className="flex gap-2">
          <Button
            variant="outline"
            disabled={pending || page <= 1}
            onClick={() => navigate(page - 1)}
          >
            이전
          </Button>
          <Button
            variant="outline"
            disabled={pending || page >= totalPages}
            onClick={() => navigate(page + 1)}
          >
            다음
          </Button>
        </nav>
      </div>
      <CloseConfirmDialog
        open={!!closeTarget}
        onOpenChange={(v) => !v && setCloseTarget(null)}
        busy={!!closingId}
        onConfirm={() => closeTarget && void handleClose(closeTarget.id)}
      />
      {extendTarget?.closingDate && (
        <ExtendDeadlineDialog
          open
          onOpenChange={(v) => !v && setExtendTarget(null)}
          postingId={extendTarget.id}
          closingDate={extendTarget.closingDate}
          onExtended={() => router.refresh()}
        />
      )}
    </div>
  )
}
