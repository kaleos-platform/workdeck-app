'use client'

import Link from 'next/link'
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
    title:
      '이 Slack 워크스페이스는 다른 스페이스가 쓰고 있습니다. 그 스페이스의 관리자만 추가로 연결할 수 있습니다',
    variant: 'destructive',
  },
  team_changed: {
    title:
      '이미 다른 Slack 워크스페이스에 연결되어 있습니다. 바꾸려면 아래 "재연결"을 누르세요. 기존 채널 등록, 진행 중 Slack 승인 메시지 연결, 대화 기록, 구성원 Slack 연결이 정리됩니다',
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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setChannelId(channel?.channelId ?? '')
  }, [channel?.channelId])

  const handleSave = useCallback(async () => {
    const trimmed = channelId.trim()
    if (!trimmed) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/slack/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: trimmed, kind }),
      })
      if (res.ok) onSaved()
      else setError(await errorMessage(res, '채널을 저장하지 못했습니다'))
    } catch {
      setError('채널을 저장하지 못했습니다')
    } finally {
      setSaving(false)
    }
  }, [channelId, kind, onSaved])

  const handleRemove = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/slack/channels?kind=${kind}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setChannelId('')
        onSaved()
      } else setError(await errorMessage(res, '채널을 해제하지 못했습니다'))
    } catch {
      setError('채널을 해제하지 못했습니다')
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
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{KIND_HINT[kind]}</p>
    </div>
  )
}

// 에이전트가 slack_post로 글을 올릴 수 있는 채널(여러 개). 승인·알림 채널에는 보내지 않는다.
function AgentChannels({
  channels,
  onSaved,
}: {
  channels: SlackChannelsResponse['channels']
  onSaved: () => void
}) {
  const [channelId, setChannelId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (url: string, init: RequestInit, fallback: string) => {
      setSaving(true)
      setError(null)
      try {
        const res = await fetch(url, init)
        if (!res.ok) return setError(await errorMessage(res, fallback))
        setChannelId('')
        onSaved()
      } catch {
        setError(fallback)
      } finally {
        setSaving(false)
      }
    },
    [onSaved]
  )

  const handleAdd = () =>
    run(
      '/api/slack/channels',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channelId.trim(), kind: 'agent' }),
      },
      '채널을 추가하지 못했습니다'
    )
  const handleRemove = (id: string) =>
    run(
      `/api/slack/channels?kind=agent&channelId=${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      '채널을 해제하지 못했습니다'
    )

  return (
    <div className="space-y-1.5">
      <Label htmlFor="slack-channel-agent">에이전트 채널</Label>
      {channels.length > 0 && (
        <ul className="space-y-1">
          {channels.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <span className="font-mono">{c.channelName ?? c.channelId}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleRemove(c.channelId)}
                disabled={saving}
                aria-label={`${c.channelId} 해제`}
              >
                해제
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id="slack-channel-agent"
          placeholder="C0123456789"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          className="max-w-64"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={handleAdd}
          disabled={saving || !channelId.trim()}
        >
          추가
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        에이전트가 글을 올릴 수 있는 채널입니다. 승인·알림 채널과 별개이며 여러 개 등록할 수
        있습니다.
      </p>
    </div>
  )
}

// 서버의 사용자용 message(409 다른 Space 사용 채널, 404 미설치 등)를 그대로 보여준다.
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null
  return typeof body?.message === 'string' ? body.message : fallback
}

export function SlackConnectCard({ slackStatus }: { slackStatus: string | null }) {
  const [data, setData] = useState<SlackChannelsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const spaceName = data?.space?.name ?? null

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
            {slackStatus === 'team_changed' && (
              <Button asChild size="sm" variant="outline">
                <Link href={'/api/slack/oauth/install?reconnect=1'}>
                  {spaceName ? `「${spaceName}」에 재연결` : '재연결'}
                </Link>
              </Button>
            )}
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
              <Link href={'/api/slack/oauth/install'}>
                {spaceName ? `「${spaceName}」에 Slack 연결` : 'Slack 연결'}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {data.space && (
              <p className="text-xs text-muted-foreground">Space: {data.space.name}</p>
            )}
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
            <AgentChannels
              channels={data.channels.filter((c) => c.kind === 'agent')}
              onSaved={load}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
