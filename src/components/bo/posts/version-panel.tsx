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

type Version = {
  versionNumber: number
  note: string | null
  createdAt: string
}

type Props = {
  postId: string
  versions: Version[]
  onRestored?: () => void
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${min}`
}

export function VersionPanel({ postId, versions, onRestored }: Props) {
  const [restoringNum, setRestoringNum] = useState<number | null>(null)
  const [openNum, setOpenNum] = useState<number | null>(null)

  async function restore(versionNumber: number) {
    setRestoringNum(versionNumber)
    try {
      const res = await fetch(`/api/bo/posts/${postId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionNumber }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message ?? '복원에 실패했습니다')
      }
      setOpenNum(null)
      toast.success(`버전 ${versionNumber}으로 복원했습니다`)
      onRestored?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '복원 실패')
    } finally {
      setRestoringNum(null)
    }
  }

  if (versions.length === 0) {
    return <p className="py-4 text-xs text-muted-foreground">아직 저장된 버전이 없습니다.</p>
  }

  return (
    <div className="space-y-1">
      {versions.map((v) => (
        <div
          key={v.versionNumber}
          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">버전 {v.versionNumber}</p>
            {v.note && <p className="truncate text-xs text-muted-foreground">{v.note}</p>}
            <p className="text-xs text-muted-foreground">{formatDate(v.createdAt)}</p>
          </div>

          <Dialog
            open={openNum === v.versionNumber}
            onOpenChange={(open) => setOpenNum(open ? v.versionNumber : null)}
          >
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 text-xs"
                disabled={restoringNum !== null}
              >
                복원
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>버전 {v.versionNumber} 복원</DialogTitle>
                <DialogDescription>
                  현재 내용이 버전 {v.versionNumber}({formatDate(v.createdAt)})으로 교체됩니다. 현재
                  내용은 새 버전으로 자동 저장됩니다.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenNum(null)}>
                  취소
                </Button>
                <Button
                  onClick={() => void restore(v.versionNumber)}
                  disabled={restoringNum !== null}
                >
                  {restoringNum === v.versionNumber ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    '복원'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ))}
    </div>
  )
}
