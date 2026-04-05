'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Bot,
  CheckCircle2,
  Loader2,
  Pencil,
  Power,
  PowerOff,
  Save,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type AgentData = {
  id: string
  slackChannelId: string | null
  enabled: boolean
  connected: boolean
  lastActiveAt: string | null
}

type AgentStatus = 'active' | 'inactive' | 'disconnected' | 'loading'

export function AgentConfig() {
  const [agent, setAgent] = useState<AgentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  // 수정 모드 폼 상태
  const [channelId, setChannelId] = useState('')

  const fetchAgent = useCallback(async () => {
    try {
      const res = await fetch('/api/deck-agents')
      if (res.ok) {
        const raw = await res.json()
        const data: AgentData | null = raw.agent ?? (raw.id ? raw : null)
        setAgent(data)
        setChannelId(data?.slackChannelId ?? '')
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

  // 에이전트 상태 계산
  const agentStatus: AgentStatus = loading
    ? 'loading'
    : agent?.enabled && agent.slackChannelId
      ? agent.connected
        ? 'active'
        : 'active' // enabled + channel이면 활성 (heartbeat 여부와 무관)
      : agent?.enabled
        ? 'disconnected' // enabled이지만 채널 미설정
        : 'inactive'

  const isConfigured = agent?.slackChannelId != null && agent.enabled

  const lastActive = agent?.lastActiveAt
    ? new Date(agent.lastActiveAt).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  // ─── 저장 (신규/수정 공통) ────────────────────────────────────────────────

  const handleSave = async () => {
    if (!channelId.trim()) {
      toast.error('Slack 채널 ID를 입력해주세요')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/deck-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slackChannelId: channelId.trim(),
          enabled: true,
        }),
      })

      if (res.ok) {
        const raw = await res.json()
        const data: AgentData = raw.agent ?? raw
        setAgent(data)
        setChannelId(data.slackChannelId ?? '')
        setIsEditing(false)
        toast.success('에이전트 설정이 저장되었습니다')
      } else {
        toast.error('저장에 실패했습니다')
      }
    } catch {
      toast.error('저장 중 오류가 발생했습니다')
    } finally {
      setSaving(false)
    }
  }

  // ─── 비활성화 ─────────────────────────────────────────────────────────────

  const handleDeactivate = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/deck-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: false,
        }),
      })

      if (res.ok) {
        const raw = await res.json()
        const data: AgentData = raw.agent ?? raw
        setAgent(data)
        setChannelId(data.slackChannelId ?? '')
        setIsEditing(false)
        toast.success('에이전트가 비활성화되었습니다')
      }
    } catch {
      toast.error('비활성화에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  // ─── 재활성화 ─────────────────────────────────────────────────────────────

  const handleReactivate = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/deck-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
        }),
      })

      if (res.ok) {
        const raw = await res.json()
        const data: AgentData = raw.agent ?? raw
        setAgent(data)
        setChannelId(data.slackChannelId ?? '')
        toast.success('에이전트가 활성화되었습니다')
      }
    } catch {
      toast.error('활성화에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  // ─── 수정 취소 ────────────────────────────────────────────────────────────

  const handleCancelEdit = () => {
    setIsEditing(false)
    setChannelId(agent?.slackChannelId ?? '')
  }

  // ─── 렌더링 ───────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>에이전트 설정</CardTitle>
              <CardDescription>
                Slack 에이전트를 연결하여 광고 데이터를 자동으로 관리합니다.
              </CardDescription>
            </div>
          </div>
          <StatusBadge status={agentStatus} />
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isConfigured && !isEditing ? (
          /* ─── 활성 상태: 보기 모드 ─── */
          <div className="space-y-4">
            {/* 연결 정보 */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {agent?.connected ? (
                    <Wifi className="h-5 w-5 text-green-500" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  )}
                  <div>
                    <p className="text-sm font-medium">Slack 에이전트 활성</p>
                    {lastActive && (
                      <p className="text-xs text-muted-foreground">
                        마지막 활동: {lastActive}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    수정
                  </Button>
                </div>
              </div>

              {/* 설정 정보 표시 */}
              <div className="flex items-center gap-6 rounded-md bg-muted/50 px-4 py-3">
                <div>
                  <p className="text-xs text-muted-foreground">Slack 채널 ID</p>
                  <code className="text-sm font-medium">{agent?.slackChannelId}</code>
                </div>
              </div>
            </div>

            {/* 비활성화 버튼 */}
            <div className="flex items-center justify-between rounded-lg border border-dashed p-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-muted-foreground">에이전트 비활성화</p>
                <p className="text-xs text-muted-foreground">
                  비활성화하면 Slack에서 명령을 수신하지 않습니다.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeactivate}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PowerOff className="mr-1 h-3.5 w-3.5" />
                )}
                비활성화
              </Button>
            </div>
          </div>
        ) : agent?.slackChannelId && !agent.enabled && !isEditing ? (
          /* ─── 비활성 상태: 재활성화 안내 ─── */
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <WifiOff className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">에이전트가 비활성 상태입니다</p>
                    <p className="text-xs text-muted-foreground">
                      채널: <code>{agent.slackChannelId}</code>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleReactivate}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Power className="mr-1 h-3.5 w-3.5" />
                    )}
                    활성화
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    수정
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ─── 수정/신규 입력 모드 ─── */
          <div className="space-y-4">
            {agent?.slackChannelId && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">에이전트 설정 수정</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelEdit}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  취소
                </Button>
              </div>
            )}

            {/* Slack 채널 ID 입력 */}
            <div className="space-y-2">
              <Label htmlFor="slack-channel-id">Slack 채널 ID</Label>
              <Input
                id="slack-channel-id"
                placeholder="예: C01234ABCDE"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                에이전트가 메시지를 수신할 Slack 채널의 ID를 입력하세요.
              </p>
            </div>

            {/* 저장 버튼 */}
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSave}
                disabled={!channelId.trim() || saving}
                className="gap-2"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                저장 및 활성화
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: AgentStatus }) {
  switch (status) {
    case 'active':
      return (
        <Badge
          className={cn(
            'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
          )}
        >
          <CheckCircle2 className="mr-1 h-3 w-3" /> 활성
        </Badge>
      )
    case 'inactive':
      return (
        <Badge variant="secondary">
          <PowerOff className="mr-1 h-3 w-3" /> 비활성
        </Badge>
      )
    case 'disconnected':
      return (
        <Badge
          className={cn(
            'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
          )}
        >
          <WifiOff className="mr-1 h-3 w-3" /> 채널 미설정
        </Badge>
      )
    default:
      return <Badge variant="secondary">확인 중</Badge>
  }
}
