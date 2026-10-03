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
import { PreviewFrame } from '@/components/hiring-posts/preview-frame'
import type { PostingEmbedIssue } from '@/lib/hiring/render-embed-html'
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
  embedIssues?: PostingEmbedIssue[]
  usesFormLink?: boolean
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

export function PostingDetail({
  posting,
  origin,
  embedHtml,
  embedIssues = [],
  usesFormLink = false,
}: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<PostingStatus>(posting.status)
  const [busy, setBusy] = useState(false)

  const hasOutputErrors = embedIssues.some((issue) => issue.severity === 'error')
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
          HTML은 발행 전에도 복사할 수 있습니다. Workdeck 지원서·공고 링크는 발행 후 공개되므로,
          HTML에 지원서 연결 버튼이 있으면 발행 상태를 확인하세요.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,680px)]">
        <div className="space-y-6">
          <section className="space-y-3 rounded-lg border p-6">
            <div>
              <h2 className="font-medium">외부 채용사이트에 게시</h2>
              <p className="text-sm text-muted-foreground">
                HTML을 복사해 사람인·알바몬 등의 공고 상세 HTML 입력란에 붙여 넣으세요. 게시 전 해당
                사이트의 미리보기를 확인하세요.
              </p>
            </div>
            {embedIssues.length > 0 && (
              <div role="alert" className="space-y-2 rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {hasOutputErrors
                    ? '수정 후 HTML을 복사할 수 있습니다.'
                    : 'HTML 복사 전 확인하세요.'}
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  {embedIssues.map((issue, index) => (
                    <li key={index}>
                      {issue.blockNumber > 0 ? `카드 ${issue.blockNumber}: ` : ''}
                      {issue.message}
                    </li>
                  ))}
                </ul>
                {hasOutputErrors && (
                  <Link
                    className="inline-block underline"
                    href={getRecruitingPostingBuildPath(posting.id)}
                  >
                    공고 수정하기
                  </Link>
                )}
              </div>
            )}
            {usesFormLink && status !== 'ACTIVE' && (
              <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
                HTML에 Workdeck 지원서 링크가 포함되어 있지만 현재 지원 접수가 열려 있지 않습니다.
                접수를 시작하거나 링크를 변경하세요.
              </p>
            )}
            <Button
              disabled={hasOutputErrors}
              onClick={() => copyText(embedHtml, 'HTML 코드를 복사했습니다')}
            >
              <Copy /> HTML 복사
            </Button>
            <details className="space-y-2">
              <summary className="cursor-pointer text-sm text-muted-foreground">
                HTML 코드 보기
              </summary>
              <Textarea
                aria-label="공고 HTML 코드"
                readOnly
                value={embedHtml}
                rows={6}
                className="font-mono text-xs"
              />
            </details>
          </section>
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
        </div>

        {/* 우측 — 공고 미리보기(임베드 HTML과 동일한 결과, PC/모바일 폭 전환) */}
        <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <h2 className="font-medium">공고 미리보기</h2>
          <PreviewFrame>
            <iframe
              title="외부 게시용 공고 미리보기"
              sandbox=""
              referrerPolicy="no-referrer"
              className="h-[70vh] min-h-96 w-full rounded-md border bg-white"
              srcDoc={`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:16px;overflow-wrap:anywhere">${embedHtml}</body></html>`}
            />
            <p className="text-xs text-muted-foreground">
              외부 게시용 HTML 미리보기입니다. 채용 사이트의 편집 설정에 따라 표시가 달라질 수
              있습니다.
            </p>
          </PreviewFrame>
        </aside>
      </div>
    </div>
  )
}
