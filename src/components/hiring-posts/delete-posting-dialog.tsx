'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export const OPEN_POSTING_DELETE_MESSAGE =
  '모집중인 공고는 삭제할 수 없어요. 먼저 마감 처리한 뒤 삭제해 주세요.'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  postingId: string
  title: string
  applicantCount: number
  // 화면 상태가 모집중이면 삭제 대신 안내만 보여준다.
  isOpen: boolean
  onDeleted: () => void
}

// 공고 삭제 확인 팝업 — 공고 상세와 목록 행 메뉴가 함께 쓴다.
export function DeletePostingDialog({
  open,
  onOpenChange,
  postingId,
  title,
  applicantCount,
  isOpen,
  onDeleted,
}: Props) {
  const [busy, setBusy] = useState(false)
  // 서버가 모집중으로 판단해 409를 준 경우에도 안내로 전환한다.
  const [blocked, setBlocked] = useState(false)

  async function handleDelete() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}`, { method: 'DELETE' })
      if (res.status === 409) {
        setBlocked(true)
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null
        throw new Error(data?.message ?? '공고를 삭제하지 못했어요')
      }
      toast.success('공고를 삭제했어요')
      onOpenChange(false)
      onDeleted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '공고를 삭제하지 못했어요')
    } finally {
      setBusy(false)
    }
  }

  const guide = isOpen || blocked
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return
        if (!v) setBlocked(false)
        onOpenChange(v)
      }}
    >
      <DialogContent>
        {guide ? (
          <>
            <DialogHeader>
              <DialogTitle>공고를 삭제할 수 없어요</DialogTitle>
              <DialogDescription>{OPEN_POSTING_DELETE_MESSAGE}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>확인</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>&quot;{title}&quot; 공고를 삭제할까요?</DialogTitle>
              <DialogDescription>
                {applicantCount > 0
                  ? `지원자 ${applicantCount.toLocaleString('ko-KR')}명과 첨부 파일도 함께 삭제되며 되돌릴 수 없어요.`
                  : '공고와 첨부 파일이 삭제되며 되돌릴 수 없어요.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                취소
              </Button>
              <Button variant="destructive" disabled={busy} onClick={() => void handleDelete()}>
                {busy ? '삭제 중…' : '삭제'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
