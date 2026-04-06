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
import { Switch } from '@/components/ui/switch'
import {
  Bell,
  CalendarClock,
  Database,
  ExternalLink,
  Loader2,
  Sparkles,
} from 'lucide-react'

type CollectionSchedule = {
  enabled: boolean
  cronExpression: string
  timezone: string
}

type AnalysisSchedule = {
  enabled: boolean
  intervalDays: number
  slackNotify: boolean
  lastAnalyzedAt: string | null
}

type ScheduledMessage = {
  id: string
  icon: React.ReactNode
  title: string
  description: string
  schedule: string
  status: 'active' | 'inactive' | 'not-configured'
  nextRun: string | null
  configTab: string | null
  toggleable: boolean
  toggled: boolean
}

type Props = {
  onNavigateTab?: (tab: string) => void
}

export function AgentScheduledMessages({ onNavigateTab }: Props) {
  const [messages, setMessages] = useState<ScheduledMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/collection/schedule').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/analysis/schedule').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([collectionRaw, analysisRaw]) => {
        const collection: CollectionSchedule | null = collectionRaw?.schedule ?? null
        const analysis: AnalysisSchedule | null = analysisRaw?.schedule ?? null

        const items: ScheduledMessage[] = []

        // 수집 완료 + KPI 요약 알림
        const collectionConfigured = collection != null
        const collectionEnabled = collection?.enabled ?? false
        items.push({
          id: 'collection-kpi',
          icon: <Database className="h-4 w-4" />,
          title: '데이터 수집 완료 + KPI 요약',
          description: '자동 수집 완료 시 수집 건수와 KPI를 Slack으로 전송합니다.',
          schedule: collectionConfigured
            ? `매일 ${cronToTime(collection!.cronExpression)} (${collection!.timezone})`
            : '스케줄 미설정',
          status: collectionEnabled ? 'active' : collectionConfigured ? 'inactive' : 'not-configured',
          nextRun: collectionEnabled ? getNextCronRun(collection!.cronExpression, collection!.timezone) : null,
          configTab: collectionConfigured ? null : 'scheduled-tasks',
          toggleable: false, // 수집 알림은 별도 필드 없음
          toggled: collectionEnabled,
        })

        // 분석 완료 알림
        const analysisConfigured = analysis != null
        const slackNotify = analysis?.slackNotify ?? false
        const analysisActive = (analysis?.enabled ?? false) && slackNotify
        items.push({
          id: 'analysis-done',
          icon: <Sparkles className="h-4 w-4" />,
          title: '분석 완료 알림',
          description: '광고 분석 완료 시 비효율 키워드와 절감 제안을 Slack으로 전송합니다.',
          schedule: analysisConfigured
            ? `${analysis!.intervalDays}일마다 자동 실행`
            : '스케줄 미설정',
          status: analysisActive ? 'active' : analysisConfigured ? 'inactive' : 'not-configured',
          nextRun: analysisActive && analysis?.lastAnalyzedAt
            ? getNextAnalysisRun(analysis.lastAnalyzedAt, analysis.intervalDays)
            : null,
          configTab: analysisConfigured ? null : 'scheduled-tasks',
          toggleable: analysisConfigured && (analysis?.enabled ?? false), // 분석이 활성일 때만 토글 가능
          toggled: slackNotify,
        })

        setMessages(items)
      })
      .catch(() => setMessages([]))
      .finally(() => setLoading(false))
  }, [])

  async function handleToggle(msgId: string, newValue: boolean) {
    if (msgId === 'analysis-done') {
      setTogglingId(msgId)
      try {
        const res = await fetch('/api/analysis/schedule', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slackNotify: newValue }),
        })
        if (res.ok) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? { ...m, toggled: newValue, status: newValue ? 'active' : 'inactive' }
                : m,
            ),
          )
        }
      } finally {
        setTogglingId(null)
      }
    }
  }

  const activeCount = messages.filter((m) => m.status === 'active').length

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>예약 알림</CardTitle>
              <CardDescription>
                에이전트가 정기적으로 발송하는 Slack 메시지 목록입니다.
              </CardDescription>
            </div>
          </div>
          {!loading && (
            <Badge variant={activeCount > 0 ? 'default' : 'secondary'}>
              {activeCount}개 활성
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex items-start gap-4 rounded-lg border p-4 transition-colors ${
                  msg.status === 'active'
                    ? 'border-border bg-background'
                    : 'border-dashed border-muted bg-muted/30'
                }`}
              >
                {/* 아이콘 */}
                <div
                  className={`mt-0.5 rounded-md p-2 ${
                    msg.status === 'active'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {msg.icon}
                </div>

                {/* 내용 */}
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{msg.title}</p>
                    <StatusBadge status={msg.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">{msg.description}</p>

                  <div className="flex items-center gap-3 pt-1">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarClock className="h-3 w-3" />
                      {msg.schedule}
                    </span>
                    {msg.status === 'active' && msg.nextRun && (
                      <span className="text-xs text-muted-foreground">
                        다음 실행: {msg.nextRun}
                      </span>
                    )}
                  </div>

                  {msg.status === 'not-configured' && msg.configTab && onNavigateTab && (
                    <button
                      type="button"
                      className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"
                      onClick={() => onNavigateTab(msg.configTab!)}
                    >
                      <ExternalLink className="h-3 w-3" />
                      예약 작업 탭에서 스케줄을 설정하세요
                    </button>
                  )}
                </div>

                {/* 토글 */}
                <div className="shrink-0 pt-1">
                  {msg.toggleable ? (
                    <Switch
                      checked={msg.toggled}
                      disabled={togglingId === msg.id}
                      onCheckedChange={(v) => handleToggle(msg.id, v)}
                    />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">자동</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: ScheduledMessage['status'] }) {
  switch (status) {
    case 'active':
      return <Badge variant="default" className="text-[10px] px-1.5 py-0">활성</Badge>
    case 'inactive':
      return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">비활성</Badge>
    case 'not-configured':
      return <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-yellow-600 border-yellow-300">미설정</Badge>
  }
}

function cronToTime(cron: string): string {
  const parts = cron.split(' ')
  if (parts.length < 2) return cron
  return `${parts[1].padStart(2, '0')}:${parts[0].padStart(2, '0')}`
}

function getNextCronRun(cron: string, _timezone: string): string | null {
  const parts = cron.split(' ')
  if (parts.length < 2) return null
  const minute = parseInt(parts[0], 10)
  const hour = parseInt(parts[1], 10)
  if (isNaN(minute) || isNaN(hour)) return null
  const next = new Date()
  next.setHours(hour, minute, 0, 0)
  if (next <= new Date()) next.setDate(next.getDate() + 1)
  return next.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function getNextAnalysisRun(lastAnalyzedAt: string, intervalDays: number): string | null {
  const last = new Date(lastAnalyzedAt)
  if (isNaN(last.getTime())) return null
  const next = new Date(last.getTime() + intervalDays * 24 * 60 * 60 * 1000)
  return next.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
