'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Loader2, Clock, CalendarClock } from 'lucide-react'

type ScheduleData = {
  enabled: boolean
  cronExpression?: string
  collectionTime?: string
  nextRunAt?: string | null
}

// cron "30 12 * * *" → "12:30"
function cronToTime(cron: string): string {
  const parts = cron.split(' ')
  if (parts.length >= 2) {
    const minute = parts[0].padStart(2, '0')
    const hour = parts[1].padStart(2, '0')
    return `${hour}:${minute}`
  }
  return '12:30'
}

// "12:30" → cron "30 12 * * *"
function timeToCron(time: string): string {
  const [hour, minute] = time.split(':')
  return `${minute || '0'} ${hour || '12'} * * *`
}

type ScheduleConfigProps = {
  embedded?: boolean
}

export function ScheduleConfig({ embedded }: ScheduleConfigProps = {}) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [collectionTime, setCollectionTime] = useState('12:30')
  const [nextRunAt, setNextRunAt] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/collection/schedule')
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((raw) => {
        const data = raw.schedule ?? raw
        setEnabled(data?.enabled ?? false)
        if (data?.cronExpression) setCollectionTime(cronToTime(data.cronExpression))
        else if (data?.collectionTime) setCollectionTime(data.collectionTime)
        if (data?.nextRunAt) setNextRunAt(data.nextRunAt)
      })
      .catch(() => {
        // 초기 상태 유지
      })
      .finally(() => setIsLoading(false))
  }, [])

  async function handleSave() {
    setIsSaving(true)
    try {
      const res = await fetch('/api/collection/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, cronExpression: timeToCron(collectionTime) }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const message = (data as { message?: string }).message ?? '설정 저장에 실패했습니다'
        toast.error(message)
        return
      }

      const raw = await res.json()
      const saved = raw.schedule ?? raw
      if (saved?.nextRunAt) setNextRunAt(saved.nextRunAt)
      toast.success('수집 스케줄이 저장되었습니다')
    } catch {
      toast.error('설정 저장 중 오류가 발생했습니다')
    } finally {
      setIsSaving(false)
    }
  }

  function formatNextRun(dateStr: string): string {
    const date = new Date(dateStr)
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    })
  }

  const content = isLoading ? (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ) : (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="space-y-0.5">
          <Label htmlFor="auto-collect" className="text-base font-medium">
            자동 수집 활성화
          </Label>
          <p className="text-sm text-muted-foreground">
            매일 지정된 시간에 자동으로 데이터를 수집합니다
          </p>
        </div>
        <Switch
          id="auto-collect"
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="collection-time" className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          수집 시간
        </Label>
        <Input
          id="collection-time"
          type="time"
          value={collectionTime}
          onChange={(e) => setCollectionTime(e.target.value)}
          className="w-40"
          disabled={!enabled}
        />
        <p className="text-xs text-muted-foreground">
          매일 이 시간에 자동 수집이 실행됩니다 (한국 시간 기준)
        </p>
      </div>

      {enabled && nextRunAt && (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-3">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm">
            다음 수집 예정: <span className="font-medium">{formatNextRun(nextRunAt)}</span>
          </p>
        </div>
      )}

      <Button onClick={handleSave} disabled={isSaving}>
        {isSaving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            저장 중...
          </>
        ) : (
          '설정 저장'
        )}
      </Button>
    </div>
  )

  if (embedded) return content

  return (
    <Card>
      <CardHeader>
        <CardTitle>자동 수집 설정</CardTitle>
        <CardDescription>
          설정된 시간에 쿠팡 광고 데이터를 자동으로 수집합니다.
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}
