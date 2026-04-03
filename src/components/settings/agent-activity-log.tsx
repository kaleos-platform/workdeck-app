'use client'

import { useState, useEffect } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Activity, Bot, Clock } from 'lucide-react'

type AgentStatus = {
  enabled: boolean
  slackChannelId: string | null
  lastActiveAt: string | null
}

export function AgentActivityLog() {
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/deck-agents')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AgentStatus | null) => setStatus(data))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false))
  }, [])

  const isConfigured = status?.slackChannelId != null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <CardTitle>에이전트 활동 로그</CardTitle>
        </div>
        <CardDescription>
          에이전트의 최근 활동 내역을 확인합니다.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        ) : !isConfigured ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12 text-center">
            <Bot className="h-10 w-10 text-muted-foreground/50" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                에이전트가 아직 설정되지 않았습니다
              </p>
              <p className="text-xs text-muted-foreground/70">
                위의 에이전트 설정에서 Slack 채널을 연결하세요.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 상태 요약 */}
            <div className="flex items-center gap-4 rounded-lg bg-muted/50 p-4">
              <div className="flex flex-1 items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">상태</span>
                <Badge variant={status.enabled ? 'default' : 'secondary'}>
                  {status.enabled ? '활성' : '비활성'}
                </Badge>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="font-medium">채널</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {status.slackChannelId}
                </code>
              </div>
            </div>

            {/* 마지막 활동 시간 */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                마지막 활동:{' '}
                {status.lastActiveAt
                  ? new Date(status.lastActiveAt).toLocaleString('ko-KR', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '활동 기록 없음'}
              </span>
            </div>

            {/* 활동 로그 placeholder */}
            <div className="rounded-lg border border-dashed py-8 text-center">
              <p className="text-xs text-muted-foreground">
                에이전트 명령 로그가 여기에 표시됩니다. (PoC)
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
