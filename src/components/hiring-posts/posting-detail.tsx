'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Copy, ExternalLink, Lock, Pencil, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PostingStatusBadge, type PostingStatus } from '@/components/hiring-posts/status-badge'
import { RECRUITING_POSTINGS_PATH, getRecruitingPostingBuildPath } from '@/lib/deck-routes'

type Posting = {
  id: string
  uuid: string
  title: string
  status: PostingStatus
  closingDate: string | null
}

type Props = {
  posting: Posting
  origin: string
  embedHtml: string
}

function formatClosingDate(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  return `마감 ${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
}

function copyText(value: string, successMessage: string) {
  navigator.clipboard.writeText(value).then(
    () => toast.success(successMessage),
    () => toast.error('복사에 실패했습니다')
  )
}

export function PostingDetail({ posting, origin, embedHtml }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<PostingStatus>(posting.status)
  const [busy, setBusy] = useState(false)

  const isDraft = status === 'DRAFT'
  const applyUrl = `${origin}/p/${posting.uuid}/apply`
  const postingUrl = `${origin}/p/${posting.uuid}`
  const previewSuffix = isDraft ? '?preview=1' : ''

  async function runAction(action: 'close' | 'reopen') {
    setBusy(true)
    try {
      const res = await fetch(`/api/hiring-posts/postings/${posting.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? '처리에 실패했습니다')
      }
      const { posting: updated } = await res.json()
      setStatus(updated.status)
      toast.success(action === 'close' ? '공고를 마감했습니다' : '공고를 재개했습니다')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '처리에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="size-9" asChild>
            <Link href={RECRUITING_POSTINGS_PATH}>
              <ArrowLeft />
              <span className="sr-only">목록으로</span>
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">{posting.title}</h1>
          <PostingStatusBadge status={status} />
          {formatClosingDate(posting.closingDate) && (
            <span className="text-sm text-muted-foreground">
              {formatClosingDate(posting.closingDate)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status === 'ACTIVE' && (
            <Button variant="outline" onClick={() => runAction('close')} disabled={busy}>
              <Lock /> 마감
            </Button>
          )}
          {status === 'CLOSED' && (
            <Button variant="outline" onClick={() => runAction('reopen')} disabled={busy}>
              <RotateCcw /> 재개
            </Button>
          )}
          <Button asChild>
            <Link href={getRecruitingPostingBuildPath(posting.id)}>
              <Pencil /> 수정
            </Link>
          </Button>
        </div>
      </div>

      {isDraft && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-900/40 dark:text-amber-200">
          발행 전 — 링크는 발행 후 공개되며, 열기는 미리보기로 표시됩니다.
        </div>
      )}

      <div className="space-y-3 rounded-lg border p-6">
        <div>
          <h2 className="font-medium">지원서 링크</h2>
          <p className="text-sm text-muted-foreground">
            링크를 채용 사이트에 등록하면 지원자를 바로 모을 수 있어요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input readOnly value={applyUrl} className="font-mono text-sm" />
          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            onClick={() => window.open(`${applyUrl}${previewSuffix}`, '_blank')}
          >
            <ExternalLink />
            <span className="sr-only">열기</span>
          </Button>
          <Button
            variant="outline"
            className="h-11 shrink-0"
            onClick={() => copyText(applyUrl, '지원서 링크를 복사했습니다')}
          >
            <Copy /> 복사
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-6">
        <div>
          <h2 className="font-medium">공고 링크</h2>
          <p className="text-sm text-muted-foreground">공고 상세 페이지 링크입니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input readOnly value={postingUrl} className="font-mono text-sm" />
          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            onClick={() => window.open(`${postingUrl}${previewSuffix}`, '_blank')}
          >
            <ExternalLink />
            <span className="sr-only">열기</span>
          </Button>
          <Button
            variant="outline"
            className="h-11 shrink-0"
            onClick={() => copyText(postingUrl, '공고 링크를 복사했습니다')}
          >
            <Copy /> 복사
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-6">
        <div>
          <h2 className="font-medium">공고 HTML 코드</h2>
          <p className="text-sm text-muted-foreground">
            채용 사이트의 공고 상세에 붙여넣으면 동일한 공고가 표시됩니다.
          </p>
        </div>
        <Textarea readOnly value={embedHtml} rows={6} className="font-mono text-xs" />
        <Button variant="outline" onClick={() => copyText(embedHtml, 'HTML 코드를 복사했습니다')}>
          <Copy /> 복사
        </Button>
      </div>
    </div>
  )
}
