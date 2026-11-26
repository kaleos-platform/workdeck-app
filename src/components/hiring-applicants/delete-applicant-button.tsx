'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RECRUITING_APPLICATIONS_PATH } from '@/lib/deck-routes'

// 지원자 상세 헤더의 삭제 버튼 — 확인 후 완전 삭제하고 목록으로 이동한다. OWNER/ADMIN에게만 렌더한다.
export function DeleteApplicantButton({ applicationId }: { applicationId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleDelete() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/hiring-applicants/applications/${applicationId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { message?: string } | null
        throw new Error(err?.message ?? '지원자를 삭제하지 못했어요')
      }
      toast.success('지원자 정보를 삭제했어요')
      setOpen(false)
      router.push(RECRUITING_APPLICATIONS_PATH)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '지원자를 삭제하지 못했어요')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="mr-1 size-3.5" />
        삭제
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>지원자 정보를 삭제할까요?</DialogTitle>
            <DialogDescription>
              지원서·메모·첨부 파일이 모두 삭제되며 되돌릴 수 없어요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void handleDelete()}>
              {busy ? '삭제 중…' : '삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
