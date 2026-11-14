'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy?: boolean
  onConfirm: () => void
}

// 공고 마감 확인 팝업 — 공고 상세와 목록 행 메뉴가 함께 쓴다.
export function CloseConfirmDialog({ open, onOpenChange, busy = false, onConfirm }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>공고를 마감할까요?</DialogTitle>
          <DialogDescription>
            마감하면 지원서를 더 받지 않습니다. 마감일이 있는 공고는 마감일 연장으로 다시 접수를 열
            수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? '마감 중…' : '마감하기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
