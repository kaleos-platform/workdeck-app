'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABEL,
  FEEDBACK_TYPE_LABEL,
} from '@/lib/feedback/policy'
import type { UserFeedbackStatus, UserFeedbackType } from '@/generated/prisma/enums'

export type FeedbackDetailData = {
  id: string
  type: UserFeedbackType
  status: UserFeedbackStatus
  body: string
  pagePath: string | null
  userAgent: string | null
  email: string
  spaceName: string | null
  memo: string
  createdAt: string
  deleteAt: string | null
}

type Attachment = {
  id: string
  url: string | null
  mimeType: string
  sizeBytes: number
  deletedAt: string | null
}

export function FeedbackDetail({ feedback }: { feedback: FeedbackDetailData }) {
  const router = useRouter()
  const [status, setStatus] = useState(feedback.status)
  const [memo, setMemo] = useState(feedback.memo)
  const [saving, setSaving] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[] | null>(null)
  const [attachError, setAttachError] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadAttachments = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/feedback/${feedback.id}/attachments`)
      if (!res.ok) throw new Error()
      setAttachments(await res.json())
      setAttachError(false)
    } catch {
      setAttachError(true)
    }
  }, [feedback.id])

  useEffect(() => {
    void loadAttachments()
  }, [loadAttachments])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/feedback/${feedback.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(status !== feedback.status && { status }),
          ...(memo !== feedback.memo && { memo: memo || null }),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? '저장에 실패했습니다')
      }
      toast.success('저장했습니다')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  async function deleteAttachments() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/feedback/${feedback.id}/attachments`, {
        method: 'DELETE',
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.message ?? '첨부 삭제에 실패했습니다')
      if (body?.failed > 0) toast.error(`${body.failed}개 삭제에 실패했습니다. 다시 시도해 주세요`)
      else toast.success('첨부를 삭제했습니다')
      setConfirmOpen(false)
      await loadAttachments()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '첨부 삭제에 실패했습니다')
    } finally {
      setDeleting(false)
    }
  }

  const live = attachments?.filter((a) => !a.deletedAt) ?? []
  const dirty = status !== feedback.status || memo !== feedback.memo

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">
        의견 상세{' '}
        <span className="text-base font-normal text-muted-foreground">
          [{FEEDBACK_TYPE_LABEL[feedback.type]}][{FEEDBACK_STATUS_LABEL[feedback.status]}]
        </span>
      </h1>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <section className="rounded-lg border p-4">
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">본문</h2>
            <p className="text-sm break-words whitespace-pre-wrap">{feedback.body}</p>
          </section>
          <section className="rounded-lg border p-4 text-sm">
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">메타</h2>
            <dl className="grid grid-cols-[88px_1fr] gap-y-1">
              <dt className="text-muted-foreground">화면 경로</dt>
              <dd className="break-all">{feedback.pagePath ?? '—'}</dd>
              <dt className="text-muted-foreground">브라우저</dt>
              <dd className="break-all">{feedback.userAgent ?? '—'}</dd>
              <dt className="text-muted-foreground">제출자</dt>
              <dd className="break-all">
                <a href={`mailto:${feedback.email}`} className="underline">
                  {feedback.email}
                </a>
              </dd>
              <dt className="text-muted-foreground">작업 공간</dt>
              <dd>{feedback.spaceName ?? '—'}</dd>
              <dt className="text-muted-foreground">접수</dt>
              <dd>{new Date(feedback.createdAt).toLocaleString('ko-KR')}</dd>
            </dl>
          </section>
        </div>
        <section className="flex flex-col gap-3 self-start rounded-lg border p-4">
          <h2 className="text-sm font-medium text-muted-foreground">상태·메모</h2>
          <Select value={status} onValueChange={(v) => setStatus(v as UserFeedbackStatus)}>
            <SelectTrigger aria-label="상태">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FEEDBACK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {FEEDBACK_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={5}
            maxLength={2000}
            aria-label="내부 메모"
            placeholder="내부 메모 (제출자에게 보이지 않습니다)"
          />
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? '저장 중...' : '저장'}
          </Button>
        </section>
      </div>
      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">첨부 이미지</h2>
        {attachError ? (
          <p className="text-sm text-destructive">첨부를 불러오지 못했습니다</p>
        ) : attachments === null ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">첨부가 없습니다</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {attachments.map((a) =>
              a.url && !a.deletedAt ? (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.url}
                    alt="첨부 이미지"
                    className="h-32 w-32 rounded-md border object-cover"
                  />
                </a>
              ) : (
                <div
                  key={a.id}
                  className="flex h-32 w-32 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground"
                >
                  {a.deletedAt ? '삭제됨' : '불러오지 못함'}
                </div>
              )
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {attachments && live.length === 0
              ? '남은 첨부 없음'
              : feedback.deleteAt
                ? `첨부 삭제 예정: ${new Date(feedback.deleteAt).toLocaleDateString('ko-KR')} (${FEEDBACK_STATUS_LABEL[feedback.status]})`
                : '삭제 예정일 없음 (완료·보류로 바꾸면 자동 삭제가 예약됩니다)'}
          </p>
          <Button
            variant="destructive"
            size="sm"
            disabled={live.length === 0}
            onClick={() => setConfirmOpen(true)}
          >
            첨부 지금 삭제
          </Button>
        </div>
      </section>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>첨부를 지금 삭제할까요?</DialogTitle>
            <DialogDescription>
              첨부 {live.length}장을 삭제합니다. 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              취소
            </Button>
            <Button variant="destructive" onClick={deleteAttachments} disabled={deleting}>
              {deleting ? '삭제 중...' : '삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
