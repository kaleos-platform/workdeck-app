'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { CheckCircle2, Slack, XCircle } from 'lucide-react'
import type { SlackChannelKind, SlackChannelsResponse } from './types'

const KIND_LABEL: Record<SlackChannelKind, string> = {
  approvals: '승인 채널',
  notifications: '알림 채널',
}

const KIND_HINT: Record<SlackChannelKind, string> = {
  approvals: '에이전트가 실행 전 승인을 요청할 때 이 채널로 메시지를 보냅니다.',
  notifications: '작업 완료·오류 등 일반 알림을 이 채널로 보냅니다.',
}

const SLACK_TOAST_MESSAGE: Record<string, { title: string; variant: 'default' | 'destructive' }> = {
  connected: { title: 'Slack 연동이 완료되었습니다', variant: 'default' },
  denied: { title: 'Slack 연동을 취소했습니다', variant: 'destructive' },
  error: { title: 'Slack 연동에 실패했습니다. 다시 시도해주세요', variant: 'destructive' },
  team_conflict: {
    title: '해당 Slack 워크스페이스는 이미 다른 스페이스에 연결되어 있습니다',
    variant: 'destructive',
  },
}

function ChannelRow({
  kind,
  channel,
  onSaved,
}: {
  kind: SlackChannelKind
  channel: SlackChannelsResponse['channels'][number] | undefined
  onSaved: () => void
}) {
  const [channelId, setChannelId] = useState(channel?.channelId ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setChannelId(channel?.channelId ?? '')
  }, [channel?.channelId])

  const handleSave = useCallback(async () => {
    const trimmed = channelId.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const res = await fetch('/api/slack/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: trimmed, kind }),
      })
      if (res.ok) onSaved()
    } finally {
      setSaving(false)
    }
  }, [channelId, kind, onSaved])

  const handleRemove = useCallback(async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/slack/channels?kind=${kind}`, { method: 'DELETE' })
      if (res.ok) {
        setChannelId('')
        onSaved()
      }
    } finally {
      setSaving(false)
    }
  }, [kind, onSaved])

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`slack-channel-${kind}`}>{KIND_LABEL[kind]}</Label>
      <div className="flex gap-2">
        <Input
          id={`slack-channel-${kind}`}
          placeholder="C0123456789"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          className="max-w-64"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={handleSave}
          disabled={saving || !channelId.trim()}
        >
          {channel ? '변경' : '등록'}
        </Button>
        {channel && (
          <Button size="sm" variant="ghost" onClick={handleRemove} disabled={saving}>
            해제
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{KIND_HINT[kind]}</p>
    </div>
  )
}

export function SlackConnectCard({ slackStatus }: { slackStatus: string | null }) {
  const [data, setData] = useState<SlackChannelsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/slack/channels')
      const json: SlackChannelsResponse | null = res.ok ? await res.json() : null
      setData(json)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toast = slackStatus ? SLACK_TOAST_MESSAGE[slackStatus] : null

  const approvalsChannel = data?.channels.find((c) => c.kind === 'approvals')
  const notificationsChannel = data?.channels.find((c) => c.kind === 'notifications')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Slack className="h-5 w-5" />
          Slack 연결
        </CardTitle>
        <CardDescription>
          워크덱 에이전트를 Slack에서 멘션으로 호출하고, 승인·알림을 채널로 받아보세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {toast && (
          <Alert variant={toast.variant}>
            {toast.variant === 'destructive' ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            <AlertTitle>{toast.title}</AlertTitle>
          </Alert>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : !data?.installed ? (
          <div className="flex flex-col items-start gap-3 rounded-md border border-dashed p-4">
            <p className="text-sm text-muted-foreground">
              아직 Slack이 연결되지 않았습니다. 연결하면 채널에서 에이전트를 멘션해 조회·요청할 수
              있습니다.
            </p>
            <Button asChild size="sm">
              <a href="/api/slack/oauth/install">Slack 연결</a>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="font-medium">
                {data.installation?.teamName ?? 'Slack 워크스페이스'}
              </span>
              <span className="text-muted-foreground">
                연결됨
                {data.installation?.createdAt &&
                  ` · ${new Date(data.installation.createdAt).toLocaleDateString('ko-KR')}`}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <ChannelRow kind="approvals" channel={approvalsChannel} onSaved={load} />
              <ChannelRow kind="notifications" channel={notificationsChannel} onSaved={load} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
