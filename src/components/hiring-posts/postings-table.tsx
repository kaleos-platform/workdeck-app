'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, Loader2, MoreHorizontal, Pencil } from 'lucide-react'
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
import { NewPostingButton } from './new-posting-button'
import { PostingStatusBadge, STATUS_LABELS, type PostingStatus } from './status-badge'
import {
  RECRUITING_POSTINGS_PATH,
  getRecruitingPostingBuildPath,
  getRecruitingPostingDetailPath,
} from '@/lib/deck-routes'

export type PostingRow = {
  id: string
  uuid: string
  title: string
  status: PostingStatus
  closingDate: string | null
  createdAt: string
  applicantCount: number
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
}: {
  postings: PostingRow[]
  total: number
  page: number
  pageSize: number
  q: string
  status: 'ALL' | PostingStatus
}) {
  const router = useRouter()
  const [query, setQuery] = useState(q)
  const [pending, startTransition] = useTransition()
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function navigate(nextPage: number, nextQuery = q, nextStatus = status) {
    const params = new URLSearchParams()
    if (nextQuery.trim()) params.set('q', nextQuery.trim())
    if (nextStatus !== 'ALL') params.set('status', nextStatus)
    if (nextPage > 1) params.set('page', String(nextPage))
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

  return (
    <div className="space-y-4" aria-busy={pending}>
      <form
        role="search"
        className="flex max-w-lg gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          navigate(1, query)
        }}
      >
        <Input
          aria-label="공고 제목 검색"
          placeholder="공고 제목 검색"
          maxLength={200}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={pending}>
          검색
        </Button>
        {(q || status !== 'ALL') && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => navigate(1, '', 'ALL')}
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
        <NewPostingButton />
      </div>

      <div className="rounded-lg border">
        <Table className="min-w-[760px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-20 w-[272px] bg-background">제목</TableHead>
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
                    : q || status !== 'ALL'
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
                  className="cursor-pointer"
                  onClick={() => router.push(getRecruitingPostingDetailPath(p.id))}
                >
                  <TableCell className="sticky left-0 z-10 bg-background font-medium">
                    <span className="block truncate" title={p.title}>
                      {p.title}
                    </span>
                  </TableCell>
                  <TableCell>
                    <PostingStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.applicantCount}</TableCell>
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
    </div>
  )
}
