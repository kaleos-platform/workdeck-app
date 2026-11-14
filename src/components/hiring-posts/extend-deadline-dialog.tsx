'use client'

import { useEffect, useRef, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { extendPosting, getExtendDateBounds } from './extend-posting'
import type { PostingStatus } from './status-badge'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  postingId: string
  // 연장 대상 공고의 현재 마감일(발행된 공고, 마감일 있음)
  closingDate: string
  onExtended: (posting: { status: PostingStatus; closingDate: string | null }) => void
}

// 마감일 연장 팝업 — 공고 상세와 목록 행 메뉴에서 함께 쓴다.
export function ExtendDeadlineDialog({
  open,
  onOpenChange,
  postingId,
  closingDate,
  onExtended,
}: Props) {
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  // 열릴 때마다 기본값(현재 마감일 +7일)으로 되돌린다.
  useEffect(() => {
    if (!open) return
    setDate(getExtendDateBounds(closingDate).defaultDate)
    setError(null)
  }, [open, closingDate])

  const { min } = getExtendDateBounds(closingDate)
  const invalid = !date || date < min

  async function submit() {
    if (inFlight.current || invalid) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const updated = await extendPosting(postingId, date)
      toast.success('마감일을 연장했습니다')
      onExtended(updated)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리에 실패했습니다')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !inFlight.current && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>마감일 연장</DialogTitle>
          <DialogDescription>
            모집 조건과 지원서는 바뀌지 않고 마감일만 늦춰집니다. 마감된 공고는 다시 접수를
            시작합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="extend-closing-date">새 마감일</Label>
          <Input
            id="extend-closing-date"
            type="date"
            value={date}
            min={min}
            disabled={busy}
            onChange={(e) => setDate(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            한국 시간 기준 마감일 23:59까지 접수합니다.
          </p>
          {date && date < min && (
            <p role="alert" className="text-sm text-destructive">
              현재 마감일보다 늦고 오늘 이후인 날짜를 선택해 주세요.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button disabled={busy || invalid} onClick={() => void submit()}>
            {busy ? '연장 중…' : '연장하기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
