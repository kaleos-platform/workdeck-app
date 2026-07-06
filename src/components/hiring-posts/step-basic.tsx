'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { PostingStatusBadge, type PostingStatus } from './status-badge'

type Props = {
  postingId: string
  initialTitle: string
  initialClosingDate: string | null
  initialNotificationEnabled: boolean
  status: PostingStatus
  onTitleChange: (title: string) => void
}

// "YYYY-MM-DDTHH:mm:ss..." → date input 용 "YYYY-MM-DD"
function toDateInput(value: string | null): string {
  if (!value) return ''
  return value.slice(0, 10)
}

export function StepBasic({
  postingId,
  initialTitle,
  initialClosingDate,
  initialNotificationEnabled,
  status,
  onTitleChange,
}: Props) {
  const router = useRouter()
  const [title, setTitle] = useState(initialTitle)
  const [closingDate, setClosingDate] = useState(toDateInput(initialClosingDate))
  const [notificationEnabled, setNotificationEnabled] = useState(initialNotificationEnabled)
  const [saving, startSave] = useTransition()

  function handleSave() {
    if (!title.trim()) {
      toast.error('제목을 입력하세요')
      return
    }
    startSave(async () => {
      try {
        const res = await fetch(`/api/hiring-posts/postings/${postingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            closingDate: closingDate || null,
            notificationEnabled,
          }),
        })
        if (!res.ok) throw new Error('저장에 실패했습니다')
        onTitleChange(title.trim())
        toast.success('기본 정보를 저장했습니다')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '저장에 실패했습니다')
      }
    })
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Label htmlFor="title">공고 제목</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 강남점 주말 아르바이트 모집"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="closingDate">마감일</Label>
        <Input
          id="closingDate"
          type="date"
          value={closingDate}
          onChange={(e) => setClosingDate(e.target.value)}
          className="w-48"
        />
        <p className="text-xs text-muted-foreground">
          비워두면 마감일 없이 상시 모집으로 운영됩니다.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border px-4 py-3">
        <div className="space-y-0.5">
          <Label htmlFor="notif">지원 알림</Label>
          <p className="text-xs text-muted-foreground">
            새 지원 발생 시 담당자에게 알림을 보냅니다.
          </p>
        </div>
        <Switch id="notif" checked={notificationEnabled} onCheckedChange={setNotificationEnabled} />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>현재 상태</span>
        <PostingStatusBadge status={status} />
      </div>

      <Button onClick={handleSave} disabled={saving}>
        저장
      </Button>
    </div>
  )
}
