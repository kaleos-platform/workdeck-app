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
import {
  Bell,
  CalendarClock,
  Database,
  Loader2,
  MessageSquare,
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
  enabled: boolean
  nextRun: string | null
}

export function AgentScheduledMessages() {
  const [messages, setMessages] = useState<ScheduledMessage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/collection/schedule').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/analysis/schedule').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([collectionRaw, analysisRaw]) => {
        const collection: CollectionSchedule | null = collectionRaw?.schedule ?? null
        const analysis: AnalysisSchedule | null =
          analysisRaw?.enabled !== undefined ? analysisRaw : null

        const items: ScheduledMessage[] = []

        // 수집 완료 알림
        items.push({
          id: 'collection-done',
          icon: <Database className="h-4 w-4" />,
          title: '데이터 수집 완료 알림',
          description: '자동 수집이 완료되면 수집 건수와 캠페인 정보를 Slack으로 전송합니다.',
          schedule: collection
            ? `매일 ${cronToTime(collection.cronExpression)} (${collection.timezone})`
            : '스케줄 미설정',
          enabled: collection?.enabled ?? false,
          nextRun: collection ? getNextCronRun(collection.cronExpression, collection.timezone) : null,
        })

        // 분석 완료 알림
        items.push({
          id: 'analysis-done',
          icon: <Sparkles className="h-4 w-4" />,
          title: '분석 완료 알림',
          description: '광고 분석이 완료되면 비효율 키워드와 절감 제안을 Slack으로 전송합니다.',
          schedule: analysis
            ? `${analysis.intervalDays}일마다 자동 실행`
            : '스케줄 미설정',
          enabled: (analysis?.enabled ?? false) && (analysis?.slackNotify ?? false),
          nextRun: analysis?.lastAnalyzedAt
            ? getNextAnalysisRun(analysis.lastAnalyzedAt, analysis.intervalDays)
            : null,
        })

        // KPI 일일 요약 (향후 기능 — placeholder)
        items.push({
          id: 'daily-kpi',
          icon: <MessageSquare className="h-4 w-4" />,
          title: 'KPI 일일 요약',
          description: '매일 주요 KPI(광고비, 매출, ROAS)를 Slack으로 요약 전송합니다.',
          schedule: '준비 중',
          enabled: false,
          nextRun: null,
        })

        setMessages(items)
      })
      .catch(() => setMessages([]))
      .finally(() => setLoading(false))
  }, [])

  const activeCount = messages.filter((m) => m.enabled).length

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
                  msg.enabled
                    ? 'border-border bg-background'
                    : 'border-dashed border-muted bg-muted/30'
                }`}
              >
                {/* 아이콘 */}
                <div
                  className={`mt-0.5 rounded-md p-2 ${
                    msg.enabled
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
                    <Badge
                      variant={msg.enabled ? 'default' : 'secondary'}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {msg.enabled ? '활성' : '비활성'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{msg.description}</p>

                  {/* 스케줄 정보 */}
                  <div className="flex items-center gap-3 pt-1">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarClock className="h-3 w-3" />
                      {msg.schedule}
                    </span>
                    {msg.enabled && msg.nextRun && (
                      <span className="text-xs text-muted-foreground">
                        다음 실행: {msg.nextRun}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── 유틸리티 ────────────────────────────────────────────────────────────────

/** cron "30 12 * * *" → "12:30" */
function cronToTime(cron: string): string {
  const parts = cron.split(' ')
  if (parts.length < 2) return cron
  const minute = parts[0].padStart(2, '0')
  const hour = parts[1].padStart(2, '0')
  return `${hour}:${minute}`
}

/** cron 다음 실행 시각 계산 (단순: 오늘/내일 기준) */
function getNextCronRun(cron: string, _timezone: string): string | null {
  const parts = cron.split(' ')
  if (parts.length < 2) return null

  const minute = parseInt(parts[0], 10)
  const hour = parseInt(parts[1], 10)
  if (isNaN(minute) || isNaN(hour)) return null

  const now = new Date()
  const next = new Date()
  next.setHours(hour, minute, 0, 0)

  if (next <= now) {
    next.setDate(next.getDate() + 1)
  }

  return next.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 분석 다음 실행 시각 계산 */
function getNextAnalysisRun(lastAnalyzedAt: string, intervalDays: number): string | null {
  const last = new Date(lastAnalyzedAt)
  if (isNaN(last.getTime())) return null

  const next = new Date(last.getTime() + intervalDays * 24 * 60 * 60 * 1000)

  return next.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
