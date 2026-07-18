'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Bell } from 'lucide-react'
import { SETTINGS_INTEGRATIONS_PATH } from '@/lib/deck-routes'
import { cn } from '@/lib/utils'

type DeckKey = 'coupang-ads' | 'seller-hub'

interface NotificationEvent {
  key: string
  label: string
  description: string
  enabled: boolean
}

interface NotificationSetting {
  enabled: boolean
  channelRegistered: boolean
  events: NotificationEvent[]
}

export function DeckSlackNotifyCard({ deckKey }: { deckKey: DeckKey }) {
  const [data, setData] = useState<NotificationSetting | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/decks/notification-setting?deckKey=${deckKey}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: NotificationSetting | null) => setData(json))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [deckKey])

  const handleToggle = useCallback(
    async (checked: boolean) => {
      setData((prev) => (prev ? { ...prev, enabled: checked } : prev))
      setSaving(true)
      try {
        const res = await fetch('/api/decks/notification-setting', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deckKey, enabled: checked }),
        })
        if (!res.ok) {
          setData((prev) => (prev ? { ...prev, enabled: !checked } : prev))
        }
      } catch {
        setData((prev) => (prev ? { ...prev, enabled: !checked } : prev))
      } finally {
        setSaving(false)
      }
    },
    [deckKey]
  )

  const handleEventToggle = useCallback(
    async (eventKey: string, checked: boolean) => {
      setData((prev) =>
        prev
          ? {
              ...prev,
              events: prev.events.map((e) => (e.key === eventKey ? { ...e, enabled: checked } : e)),
            }
          : prev
      )
      setSaving(true)
      try {
        const res = await fetch('/api/decks/notification-setting', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deckKey, events: { [eventKey]: checked } }),
        })
        if (!res.ok) {
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  events: prev.events.map((e) =>
                    e.key === eventKey ? { ...e, enabled: !checked } : e
                  ),
                }
              : prev
          )
        }
      } catch {
        setData((prev) =>
          prev
            ? {
                ...prev,
                events: prev.events.map((e) =>
                  e.key === eventKey ? { ...e, enabled: !checked } : e
                ),
              }
            : prev
        )
      } finally {
        setSaving(false)
      }
    },
    [deckKey]
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Slack 알림
        </CardTitle>
        <CardDescription>
          이 Deck의 작업 완료·실패 알림을 연동된 Slack 알림 채널로 발송합니다. 끄면 이 Deck의 모든
          Slack 알림(분석·예약 메시지 포함)이 발송되지 않습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between rounded-md border p-3">
          <Label htmlFor={`deck-slack-notify-${deckKey}`}>Slack 알림 발송</Label>
          <Switch
            id={`deck-slack-notify-${deckKey}`}
            checked={data?.enabled ?? false}
            disabled={loading || saving}
            onCheckedChange={handleToggle}
          />
        </div>
        {data?.channelRegistered === false && (
          <p className="text-xs text-muted-foreground">
            알림 채널이 등록되지 않았습니다.{' '}
            <Link href={SETTINGS_INTEGRATIONS_PATH} className="underline underline-offset-2">
              연동 설정
            </Link>
            에서 Slack 알림 채널을 등록하세요.
          </p>
        )}
        {data && data.events.length > 0 && (
          <div
            className={cn(
              'space-y-2 transition-opacity',
              !data.enabled && 'pointer-events-none opacity-50'
            )}
          >
            <p className="text-sm font-medium">알림 항목</p>
            {data.events.map((event) => (
              <div
                key={event.key}
                className="flex items-center justify-between gap-4 rounded-md border p-3"
              >
                <div className="space-y-0.5">
                  <Label htmlFor={`deck-slack-notify-${deckKey}-${event.key}`}>{event.label}</Label>
                  <p className="text-xs text-muted-foreground">{event.description}</p>
                </div>
                <Switch
                  id={`deck-slack-notify-${deckKey}-${event.key}`}
                  checked={event.enabled}
                  disabled={loading || saving || !data.enabled}
                  onCheckedChange={(checked) => handleEventToggle(event.key, checked)}
                />
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          오류 알림(수집 실패·로그인 실패·데이터 노후)은 Slack 알림이 켜져 있으면 항상 발송됩니다.
        </p>
      </CardContent>
    </Card>
  )
}
