'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PostingStatusBadge, STATUS_LABELS, type PostingStatus } from './status-badge'
import { getHiringPostingBuildPath } from '@/lib/deck-routes'

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

export function PostingsTable({ postings }: { postings: PostingRow[] }) {
  const router = useRouter()
  const [tab, setTab] = useState<'ALL' | PostingStatus>('ALL')
  const [creating, startCreate] = useTransition()

  const filtered = useMemo(
    () => (tab === 'ALL' ? postings : postings.filter((p) => p.status === tab)),
    [postings, tab]
  )

  function handleCreate() {
    startCreate(async () => {
      try {
        const res = await fetch('/api/hiring-posts/postings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!res.ok) throw new Error('공고 생성에 실패했습니다')
        const { posting } = await res.json()
        router.push(getHiringPostingBuildPath(posting.id))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '공고 생성에 실패했습니다')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'ALL' | PostingStatus)}>
          <TabsList>
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button onClick={handleCreate} disabled={creating}>
          <Plus /> 새 공고
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>제목</TableHead>
              <TableHead className="w-24">상태</TableHead>
              <TableHead className="w-24 text-right">지원자</TableHead>
              <TableHead className="w-32">마감일</TableHead>
              <TableHead className="w-32">작성일</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                  공고가 없습니다. “새 공고”로 첫 공고를 만들어 보세요.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer"
                  onClick={() => router.push(getHiringPostingBuildPath(p.id))}
                >
                  <TableCell className="font-medium">{p.title}</TableCell>
                  <TableCell>
                    <PostingStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.applicantCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(p.closingDate)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
