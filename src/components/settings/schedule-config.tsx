'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Loader2, Clock, CalendarClock } from 'lucide-react'

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
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [collectionTime, setCollectionTime] = useState('12:30')

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
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  const saveSchedule = useCallback(async (newEnabled: boolean, newTime: string) => {
    setSaving(true)
    try {
      const res = await fetch('/api/collection/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled, cronExpression: timeToCron(newTime) }),
      })
      if (!res.ok) {
        toast.error('설정 저장에 실패했습니다')
      }
    } catch {
      toast.error('설정 저장 중 오류가 발생했습니다')
    } finally {
      setSaving(false)
    }
  }, [])

  function handleEnabledChange(value: boolean) {
    setEnabled(value)
    saveSchedule(value, collectionTime)
  }

  function handleTimeBlur() {
    if (enabled) {
      saveSchedule(enabled, collectionTime)
    }
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
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <Switch
            id="auto-collect"
            checked={enabled}
            onCheckedChange={handleEnabledChange}
          />
        </div>
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
          onBlur={handleTimeBlur}
          className="w-40"
          disabled={!enabled}
        />
        <p className="text-xs text-muted-foreground">
          매일 이 시간에 자동 수집이 실행됩니다 (한국 시간 기준)
        </p>
      </div>
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
