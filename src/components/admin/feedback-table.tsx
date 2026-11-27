'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABEL,
  FEEDBACK_TYPES,
  FEEDBACK_TYPE_LABEL,
} from '@/lib/feedback/policy'
import type { UserFeedbackStatus, UserFeedbackType } from '@/generated/prisma/enums'

export type FeedbackRow = {
  id: string
  createdAt: string
  type: UserFeedbackType
  status: UserFeedbackStatus
  body: string
  email: string
  spaceName: string | null
  attachmentCount: number
}

export type FeedbackSummary = {
  counts: Record<UserFeedbackStatus, number>
  totalBytes: number
  capBytes: number
}

const ALL = 'ALL'
const mb = (bytes: number) => (bytes / 1048576).toFixed(1)

function href(type: string, status: string, page: number) {
  const q = new URLSearchParams()
  if (type) q.set('type', type)
  if (status) q.set('status', status)
  if (page > 1) q.set('page', String(page))
  const s = q.toString()
  return s ? `/admin/feedback?${s}` : '/admin/feedback'
}

export function FeedbackTable({
  rows,
  summary,
  type,
  status,
  page,
  pageCount,
}: {
  rows: FeedbackRow[]
  summary: FeedbackSummary
  type: string
  status: string
  page: number
  pageCount: number
}) {
  const router = useRouter()
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
        {FEEDBACK_STATUSES.map((s) => `${FEEDBACK_STATUS_LABEL[s]} ${summary.counts[s]}`).join(' · ')}
        {' · '}첨부 용량 {mb(summary.totalBytes)}MB / {Math.round(summary.capBytes / 1048576)}MB
      </div>
      <div className="flex flex-wrap gap-2">
        <Select
          value={type || ALL}
          onValueChange={(v) => router.push(href(v === ALL ? '' : v, status, 1))}
        >
          <SelectTrigger className="w-36" aria-label="유형 필터">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 유형</SelectItem>
            {FEEDBACK_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {FEEDBACK_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status || ALL}
          onValueChange={(v) => router.push(href(type, v === ALL ? '' : v, 1))}
        >
          <SelectTrigger className="w-36" aria-label="상태 필터">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 상태</SelectItem>
            {FEEDBACK_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {FEEDBACK_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] table-fixed text-left">
          <colgroup>
            <col className="w-[110px]" />
            <col className="w-[100px]" />
            <col className="w-[80px]" />
            <col className="w-[200px]" />
            <col className="w-[140px]" />
            <col />
            <col className="w-[60px]" />
          </colgroup>
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="p-2">접수일</th>
              <th className="p-2">유형</th>
              <th className="p-2">상태</th>
              <th className="p-2">제출자</th>
              <th className="p-2">작업 공간</th>
              <th className="p-2">본문 요약</th>
              <th className="p-2">첨부</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b align-top text-sm hover:bg-muted/40">
                <td className="p-2 text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleDateString('ko-KR')}
                </td>
                <td className="p-2">{FEEDBACK_TYPE_LABEL[r.type]}</td>
                <td className="p-2">{FEEDBACK_STATUS_LABEL[r.status]}</td>
                <td className="truncate p-2 text-xs" title={r.email}>
                  {r.email}
                </td>
                <td className="truncate p-2 text-xs" title={r.spaceName ?? ''}>
                  {r.spaceName ?? '—'}
                </td>
                <td className="p-2">
                  <Link
                    href={`/admin/feedback/${r.id}`}
                    className="line-clamp-2 break-words hover:underline"
                  >
                    {r.body}
                  </Link>
                </td>
                <td className="p-2">{r.attachmentCount}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                  접수된 의견이 없습니다
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-4 text-sm">
          {page > 1 ? <Link href={href(type, status, page - 1)}>이전</Link> : null}
          <span className="text-muted-foreground">
            {page} / {pageCount}
          </span>
          {page < pageCount ? <Link href={href(type, status, page + 1)}>다음</Link> : null}
        </div>
      ) : null}
    </div>
  )
}
