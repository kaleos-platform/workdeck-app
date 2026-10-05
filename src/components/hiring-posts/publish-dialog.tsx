'use client'

import { useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isHiringDeadlinePassed } from '@/lib/hiring/closing-date'
import type { PostingStatus } from './status-badge'

type Props = {
  postingId: string
  closingDate: string | null
  onPublished: (posting: { status: PostingStatus; closingDate: string | null }) => void
}

export function PublishDialog({ postingId, closingDate, onPublished }: Props) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(closingDate?.slice(0, 10) ?? '')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const expired = !!date && isHiringDeadlinePassed(new Date(date))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())

  async function publish() {
    if (inFlight.current || expired) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish', closingDate: date || null }),
      })
      const data = await res.json()
      if (!res.ok)
        throw new Error(
          Array.isArray(data.errors)
            ? data.errors.join(' · ')
            : data.message || '발행에 실패했습니다'
        )
      onPublished(data.posting)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '발행에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (inFlight.current) return
        if (value) {
          setDate(closingDate?.slice(0, 10) ?? '')
          setError(null)
        }
        setOpen(value)
      }}
    >
      <DialogTrigger asChild>
        <Button>공고 발행</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>공고 발행</DialogTitle>
          <DialogDescription>
            모집 기간을 확인해 주세요. 발행하면 공고가 공개되고 지원서 접수가 시작됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="publish-closing-date">지원서 마감일</Label>
          <Input
            id="publish-closing-date"
            type="date"
            value={date}
            min={today}
            disabled={busy}
            onChange={(e) => setDate(e.target.value)}
          />
          <Button variant="outline" size="sm" disabled={busy || !date} onClick={() => setDate('')}>
            상시 모집으로 변경
          </Button>
          <p className="text-sm text-muted-foreground">
            {date
              ? '한국 시간 기준 마감일 23:59까지 접수합니다.'
              : '상시 모집: 직접 마감하기 전까지 지원서를 받습니다.'}
          </p>
          {expired && (
            <p role="alert" className="text-sm text-destructive">
              마감일이 지났습니다. 오늘 이후 날짜를 선택하거나 상시 모집으로 변경해 주세요.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error} 공고 수정에서 발행 요건을 확인해 주세요.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button disabled={busy || expired} onClick={() => void publish()}>
            {busy ? '발행 중…' : '발행하기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
