'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Bot, Loader2, Save, Wifi, WifiOff } from 'lucide-react'

type AgentData = {
  id: string
  slackChannelId: string | null
  enabled: boolean
  connected: boolean
  lastActiveAt: string | null
}

export function AgentConfig() {
  const [agent, setAgent] = useState<AgentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [channelId, setChannelId] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [dirty, setDirty] = useState(false)

  const fetchAgent = useCallback(async () => {
    try {
      const res = await fetch('/api/deck-agents')
      if (res.ok) {
        const data: AgentData = await res.json()
        setAgent(data)
        setChannelId(data.slackChannelId ?? '')
        setEnabled(data.enabled)
      } else {
        setAgent(null)
      }
    } catch {
      setAgent(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAgent()
  }, [fetchAgent])

  const handleChannelIdChange = (value: string) => {
    setChannelId(value)
    setDirty(true)
  }

  const handleEnabledChange = (value: boolean) => {
    setEnabled(value)
    setDirty(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/deck-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slackChannelId: channelId || null,
          enabled,
        }),
      })

      if (res.ok) {
        const data: AgentData = await res.json()
        setAgent(data)
        setChannelId(data.slackChannelId ?? '')
        setEnabled(data.enabled)
        setDirty(false)
      }
    } catch {
      // TODO: error toast
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  const isConnected = agent?.connected ?? false
  const lastActive = agent?.lastActiveAt
    ? new Date(agent.lastActiveAt).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <CardTitle>에이전트 설정</CardTitle>
        </div>
        <CardDescription>
          Slack 에이전트를 연결하여 광고 데이터를 자동으로 관리합니다.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* 연결 상태 */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="flex items-center gap-3">
            {isConnected ? (
              <Wifi className="h-5 w-5 text-green-500" />
            ) : (
              <WifiOff className="h-5 w-5 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium">연결 상태</p>
              {lastActive && (
                <p className="text-xs text-muted-foreground">
                  마지막 활동: {lastActive}
                </p>
              )}
            </div>
          </div>
          <Badge variant={isConnected ? 'default' : 'secondary'}>
            {isConnected ? '연결됨' : '미연결'}
          </Badge>
        </div>

        {/* Slack 채널 ID */}
        <div className="space-y-2">
          <Label htmlFor="slack-channel-id">Slack 채널 ID</Label>
          <Input
            id="slack-channel-id"
            placeholder="예: C01234ABCDE"
            value={channelId}
            onChange={(e) => handleChannelIdChange(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            에이전트가 메시지를 수신할 Slack 채널의 ID를 입력하세요.
          </p>
        </div>

        {/* 활성화 스위치 */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="agent-enabled">에이전트 활성화</Label>
            <p className="text-xs text-muted-foreground">
              에이전트를 활성화하면 Slack 채널에서 명령을 수신합니다.
            </p>
          </div>
          <Switch
            id="agent-enabled"
            checked={enabled}
            onCheckedChange={handleEnabledChange}
          />
        </div>
      </CardContent>

      <CardFooter>
        <Button onClick={handleSave} disabled={!dirty || saving} className="gap-2">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          저장
        </Button>
      </CardFooter>
    </Card>
  )
}
