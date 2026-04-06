'use client'

import { useState, useEffect, useCallback } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

type Schedule = {
  enabled: boolean
  intervalDays: number
  slackNotify: boolean
  lastAnalyzedAt: string | null
}

const DEFAULT_SCHEDULE: Schedule = {
  enabled: false,
  intervalDays: 7,
  slackNotify: false,
  lastAnalyzedAt: null,
}

function formatDate(iso: string | null): string {
  if (!iso) return '없음'
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function getNextDate(lastAnalyzedAt: string | null, intervalDays: number): string {
  if (!lastAnalyzedAt) return '미정'
  const next = new Date(lastAnalyzedAt)
  next.setDate(next.getDate() + intervalDays)
  return next.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function AnalysisSchedule() {
  const [schedule, setSchedule] = useState<Schedule>(DEFAULT_SCHEDULE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchSchedule = useCallback(async () => {
    try {
      const res = await fetch('/api/analysis/schedule')
      if (res.ok) {
        const data = await res.json()
        if (data.schedule) {
          setSchedule(data.schedule)
        }
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSchedule()
  }, [fetchSchedule])

  async function saveSchedule(updated: Schedule) {
    setSchedule(updated)
    setSaving(true)
    try {
      await fetch('/api/analysis/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
    } finally {
      setSaving(false)
    }
  }

  function handleEnabledChange(enabled: boolean) {
    saveSchedule({ ...schedule, enabled })
  }

  function handleIntervalChange(value: string) {
    saveSchedule({ ...schedule, intervalDays: Number(value) })
  }

  function handleSlackChange(slackNotify: boolean) {
    saveSchedule({ ...schedule, slackNotify })
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>자동 분석 설정</CardTitle>
        <CardDescription>
          수집된 광고 데이터를 주기적으로 AI 분석하여 개선 제안을 생성합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 자동 분석 on/off */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="auto-analysis" className="text-sm font-medium">
              자동 분석
            </Label>
            <p className="text-xs text-muted-foreground">
              설정된 간격으로 분석을 자동 실행합니다
            </p>
          </div>
          <Switch
            id="auto-analysis"
            checked={schedule.enabled}
            onCheckedChange={handleEnabledChange}
          />
        </div>

        {/* 분석 간격 */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">분석 간격</Label>
            <p className="text-xs text-muted-foreground">
              자동 분석 실행 주기를 선택합니다
            </p>
          </div>
          <Select
            value={String(schedule.intervalDays)}
            onValueChange={handleIntervalChange}
            disabled={!schedule.enabled}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3일</SelectItem>
              <SelectItem value="5">5일</SelectItem>
              <SelectItem value="7">7일</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Slack 공유 */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="slack-notify" className="text-sm font-medium">
              Slack 공유
            </Label>
            <p className="text-xs text-muted-foreground">
              분석 결과를 Slack으로 공유합니다
            </p>
          </div>
          <Switch
            id="slack-notify"
            checked={schedule.slackNotify}
            onCheckedChange={handleSlackChange}
          />
        </div>

        {/* 날짜 정보 */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex items-center gap-4 text-sm">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">마지막 분석일</p>
              <p className="font-medium">
                {formatDate(schedule.lastAnalyzedAt)}
              </p>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">다음 예정일</p>
              <p className={cn('font-medium', schedule.enabled && 'text-primary')}>
                {schedule.enabled
                  ? getNextDate(schedule.lastAnalyzedAt, schedule.intervalDays)
                  : '비활성'}
              </p>
            </div>
          </div>
        </div>

        {/* Info text */}
        <p className="text-xs text-muted-foreground">
          분석 실행 버튼으로 수동 실행할 수 있습니다.
        </p>

        {/* Saving indicator */}
        {saving && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            저장 중...
          </div>
        )}
      </CardContent>
    </Card>
  )
}
