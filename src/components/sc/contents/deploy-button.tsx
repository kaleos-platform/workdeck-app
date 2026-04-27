'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Channel = { id: string; name: string; platform: string }
type Props = {
  contentId: string
  contentTitle: string
  defaultChannelId: string | null
  channels: Channel[]
}

export function DeployButton({ contentId, contentTitle, defaultChannelId, channels }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [channelId, setChannelId] = useState(defaultChannelId ?? channels[0]?.id ?? '')
  const [targetUrl, setTargetUrl] = useState('')
  const [utmCampaign, setUtmCampaign] = useState(contentTitle.slice(0, 50))
  const [scheduledAt, setScheduledAt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (!channelId) {
      setError('채널을 선택하세요')
      return
    }
    if (!targetUrl) {
      setError('타겟 URL 을 입력하세요')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/sc/deployments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentId,
          channelId,
          targetUrl,
          utmCampaign: utmCampaign || undefined,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? '배포 생성 실패')
        return
      }
      setOpen(false)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} disabled={channels.length === 0}>
        {channels.length === 0 ? '채널 없음 (먼저 채널 등록)' : '배포 예약'}
      </Button>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">배포 예약</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>채널</Label>
          <Select value={channelId} onValueChange={setChannelId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} ({c.platform})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="targetUrl">타겟 URL (랜딩/상품)</Label>
          <Input
            id="targetUrl"
            type="url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://example.com/landing"
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="utmCampaign">utm_campaign</Label>
            <Input
              id="utmCampaign"
              value={utmCampaign}
              onChange={(e) => setUtmCampaign(e.target.value)}
              placeholder="q3-launch"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scheduledAt">예약 시각 (선택)</Label>
            <Input
              id="scheduledAt"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? '생성 중…' : '배포 생성'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
