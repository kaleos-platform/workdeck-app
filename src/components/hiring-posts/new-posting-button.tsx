'use client'

import { useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { getRecruitingPostingBuildPath } from '@/lib/deck-routes'

export function NewPostingButton() {
  const router = useRouter()
  const titleId = useId()
  const submitting = useRef(false)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)

  async function createPosting(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || submitting.current) return
    submitting.current = true
    setCreating(true)
    try {
      const res = await fetch('/api/hiring-posts/postings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      if (!res.ok) throw new Error('공고 생성에 실패했습니다')
      const { posting } = await res.json()
      router.push(getRecruitingPostingBuildPath(posting.id))
      setOpen(false)
      setTitle('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '공고 생성에 실패했습니다')
    } finally {
      submitting.current = false
      setCreating(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting.current) setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> 새 공고
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={createPosting} className="space-y-4">
          <DialogHeader>
            <DialogTitle>새 공고 만들기</DialogTitle>
            <DialogDescription>제목을 입력하면 초안과 본문 제목을 함께 만듭니다.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={titleId}>공고 제목</Label>
            <Input
              id={titleId}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              required
              disabled={creating}
              placeholder="예: 강남점 주말 아르바이트 모집"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={creating}
              onClick={() => setOpen(false)}
            >
              취소
            </Button>
            <Button type="submit" disabled={creating || !title.trim()}>
              {creating && <Loader2 className="size-4 animate-spin" />}
              {creating ? '생성 중…' : '공고 만들기'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
