'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { BoPostStatus } from './post-status-badge'

type Props = {
  postId: string
  status: BoPostStatus
  errorMessage?: string | null
  onStatusChange?: (newStatus: BoPostStatus) => void
  onRegenerateStart?: () => void
  onRegenerateEnd?: () => void
}

export function StatusActionBar({
  postId,
  status,
  errorMessage,
  onStatusChange,
  onRegenerateStart,
  onRegenerateEnd,
}: Props) {
  const [pending, setPending] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [approveOpen, setApproveOpen] = useState(false)
  const [regenOpen, setRegenOpen] = useState(false)

  async function transition(newStatus: BoPostStatus) {
    setPending(true)
    try {
      const res = await fetch(`/api/bo/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message ?? '상태 변경에 실패했습니다')
      }
      const data = (await res.json()) as { post?: { status: BoPostStatus } }
      onStatusChange?.(data.post?.status ?? newStatus)
      setApproveOpen(false)
      toast.success('상태가 변경되었습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '상태 변경 실패')
    } finally {
      setPending(false)
    }
  }

  async function regenerate() {
    setRegenerating(true)
    onRegenerateStart?.()
    try {
      const res = await fetch(`/api/bo/posts/${postId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'full' }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message ?? '재생성 요청에 실패했습니다')
      }
      setRegenOpen(false)
      onStatusChange?.('GENERATING')
      toast.success('재생성 요청이 완료되었습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '재생성 실패')
    } finally {
      setRegenerating(false)
      onRegenerateEnd?.()
    }
  }

  const isDisabled = pending || regenerating

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-4 py-3">
      {/* FAILED: 오류 메시지 + 재시도 */}
      {status === 'FAILED' && (
        <>
          <p className="flex-1 truncate text-xs text-destructive">
            {errorMessage ?? '생성 중 오류가 발생했습니다'}
          </p>
          <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="destructive" disabled={isDisabled}>
                재시도
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>포스트 전체 재생성</DialogTitle>
                <DialogDescription>
                  AI가 포스트를 처음부터 다시 생성합니다. 현재 내용은 버전으로 보존됩니다.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRegenOpen(false)}>
                  취소
                </Button>
                <Button onClick={() => void regenerate()} disabled={regenerating}>
                  {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : '재생성'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* DRAFT: 검토 시작 + 전체 재생성 */}
      {status === 'DRAFT' && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={isDisabled}
            onClick={() => void transition('IN_REVIEW')}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : '검토 시작'}
          </Button>

          <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                disabled={isDisabled}
              >
                전체 재생성
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>포스트 전체 재생성</DialogTitle>
                <DialogDescription>
                  AI가 포스트를 처음부터 다시 생성합니다. 현재 내용은 버전으로 보존됩니다.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRegenOpen(false)}>
                  취소
                </Button>
                <Button onClick={() => void regenerate()} disabled={regenerating}>
                  {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : '재생성'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* IN_REVIEW: 발행 승인 + 초안으로 */}
      {status === 'IN_REVIEW' && (
        <>
          <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={isDisabled}
              >
                발행 승인
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>발행 승인</DialogTitle>
                <DialogDescription>
                  이 포스트를 발행 승인 상태로 변경합니다. 이후 편집 시 검토 중 상태로 돌아갑니다.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setApproveOpen(false)}>
                  취소
                </Button>
                <Button onClick={() => void transition('PUBLISH_APPROVED')} disabled={pending}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : '승인'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button
            size="sm"
            variant="outline"
            disabled={isDisabled}
            onClick={() => void transition('DRAFT')}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : '초안으로'}
          </Button>
        </>
      )}

      {/* PUBLISH_APPROVED / PUBLISHED: 보관 */}
      {(status === 'PUBLISH_APPROVED' || status === 'PUBLISHED') && (
        <Button
          size="sm"
          variant="outline"
          className="text-muted-foreground"
          disabled={isDisabled}
          onClick={() => void transition('ARCHIVED')}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : '보관'}
        </Button>
      )}

      {/* ARCHIVED: 초안으로 복구 */}
      {status === 'ARCHIVED' && (
        <Button
          size="sm"
          variant="outline"
          disabled={isDisabled}
          onClick={() => void transition('DRAFT')}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : '초안으로 복구'}
        </Button>
      )}
    </div>
  )
}
