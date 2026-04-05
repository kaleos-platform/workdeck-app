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
import { Activity, AlertCircle, Bell, Bot, MessageSquare, Terminal } from 'lucide-react'

type AgentLog = {
  id: string
  type: string
  command: string | null
  response: string | null
  channel: string | null
  createdAt: string
}

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  command: {
    icon: <Terminal className="h-3.5 w-3.5" />,
    label: '명령',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  },
  notification: {
    icon: <Bell className="h-3.5 w-3.5" />,
    label: '알림',
    color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  },
  error: {
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    label: '오류',
    color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  },
}

export function AgentActivityLog() {
  const [logs, setLogs] = useState<AgentLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/deck-agents/logs?limit=20')
      .then((res) => (res.ok ? res.json() : { logs: [] }))
      .then((data) => setLogs(data.logs ?? []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>에이전트 활동 로그</CardTitle>
            <CardDescription>
              에이전트의 최근 명령 및 알림 내역입니다.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12 text-center">
            <Bot className="h-10 w-10 text-muted-foreground/50" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                활동 기록이 없습니다
              </p>
              <p className="text-xs text-muted-foreground/70">
                에이전트가 Slack에서 명령을 수신하거나 알림을 발송하면 기록됩니다.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => {
              const config = TYPE_CONFIG[log.type] ?? TYPE_CONFIG.command
              const time = new Date(log.createdAt).toLocaleString('ko-KR', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })

              return (
                <div
                  key={log.id}
                  className="flex items-start gap-3 rounded-lg border px-4 py-3"
                >
                  {/* 타입 아이콘 */}
                  <div className="mt-0.5">
                    <Badge className={`${config.color} gap-1 text-[10px] px-1.5 py-0`}>
                      {config.icon}
                      {config.label}
                    </Badge>
                  </div>

                  {/* 내용 */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {log.command ?? log.type}
                    </p>
                    {log.response && (
                      <p className="text-xs text-muted-foreground truncate">
                        {log.response}
                      </p>
                    )}
                  </div>

                  {/* 시간 */}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {time}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
