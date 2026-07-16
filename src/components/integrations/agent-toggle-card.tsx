'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Bot } from 'lucide-react'
import type { AgentSettingsResponse } from './types'

export function AgentToggleCard() {
  const [data, setData] = useState<AgentSettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/agent/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((json: AgentSettingsResponse | null) => setData(json))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  const handleToggle = useCallback(async (checked: boolean) => {
    setData((prev) => (prev ? { ...prev, agentActive: checked } : prev))
    setSaving(true)
    try {
      const res = await fetch('/api/agent/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentActive: checked }),
      })
      if (!res.ok) {
        // 실패 시 되돌림
        setData((prev) => (prev ? { ...prev, agentActive: !checked } : prev))
      }
    } finally {
      setSaving(false)
    }
  }, [])

  const usage = data?.usage

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          workdeck 에이전트
        </CardTitle>
        <CardDescription>
          Slack이나 채팅에서 워크덱 에이전트를 멘션(@workdeck)하면 재무·판매 데이터를 조회하고, 변경
          작업은 승인 큐를 거쳐 실행됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="agent-active">에이전트 활성화</Label>
            <p className="text-xs text-muted-foreground">
              끄면 멘션에 응답하지 않습니다(정형 명령·도움말 포함).
            </p>
          </div>
          <Switch
            id="agent-active"
            checked={data?.agentActive ?? true}
            disabled={loading || saving}
            onCheckedChange={handleToggle}
          />
        </div>

        <div className="rounded-md bg-muted/50 p-3 text-sm">
          <p className="font-medium">오늘 사용량</p>
          {loading ? (
            <p className="mt-1 text-xs text-muted-foreground">불러오는 중...</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              요청 {usage?.requestCount ?? 0} / {usage?.dailyLimit ?? '-'}회 · 토큰{' '}
              {((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)).toLocaleString('ko-KR')}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
