'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Location = {
  id: string
  name: string
  isActive: boolean
}

type Settings = {
  defaultLocationId: string | null
  slackWebhookUrl: string | null
  preferences: Record<string, unknown>
}

const NO_LOCATION_VALUE = '__none__'

export function SettingsPanel() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [locations, setLocations] = useState<Location[]>([])
  const [defaultLocationId, setDefaultLocationId] = useState<string>(NO_LOCATION_VALUE)
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('')
  const [preferences, setPreferences] = useState<Record<string, unknown>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sRes, lRes] = await Promise.all([
        fetch('/api/inv/settings'),
        fetch('/api/inv/locations?isActive=true'),
      ])
      if (!sRes.ok) throw new Error('설정 조회 실패')
      if (!lRes.ok) throw new Error('위치 조회 실패')
      const sData = (await sRes.json()) as { settings: Settings }
      const lData = (await lRes.json()) as { locations: Location[] }
      setLocations(lData.locations ?? [])
      setDefaultLocationId(sData.settings.defaultLocationId ?? NO_LOCATION_VALUE)
      setSlackWebhookUrl(sData.settings.slackWebhookUrl ?? '')
      setPreferences(sData.settings.preferences ?? {})
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : '데이터 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const webhookInvalid =
    slackWebhookUrl.trim().length > 0 &&
    !slackWebhookUrl.trim().startsWith('https://hooks.slack.com/')

  async function handleSave() {
    if (webhookInvalid) {
      toast.error('Slack 웹훅 URL 형식이 올바르지 않습니다')
      return
    }
    setSaving(true)
    try {
      const payload = {
        defaultLocationId: defaultLocationId === NO_LOCATION_VALUE ? null : defaultLocationId,
        slackWebhookUrl: slackWebhookUrl.trim() ? slackWebhookUrl.trim() : null,
        preferences,
      }
      const res = await fetch('/api/inv/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success('설정이 저장되었습니다')
      if (data?.settings) {
        setDefaultLocationId(data.settings.defaultLocationId ?? NO_LOCATION_VALUE)
        setSlackWebhookUrl(data.settings.slackWebhookUrl ?? '')
        setPreferences(data.settings.preferences ?? {})
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* ─── Section 1: 기본 설정 ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>기본 설정</CardTitle>
          <CardDescription>재고 덱의 기본 동작을 설정합니다</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="default-location">기본 보관 위치</Label>
            <Select value={defaultLocationId} onValueChange={setDefaultLocationId}>
              <SelectTrigger id="default-location">
                <SelectValue placeholder="위치 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LOCATION_VALUE}>선택 안 함</SelectItem>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">이동 기록 입력 시 기본으로 선택됩니다</p>
          </div>
        </CardContent>
      </Card>

      {/* ─── Section 2: Slack 알림 ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Slack 알림</CardTitle>
          <CardDescription>중요한 재고 이벤트를 Slack으로 전달합니다</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="slack-webhook">Slack 웹훅 URL</Label>
            <Input
              id="slack-webhook"
              type="url"
              value={slackWebhookUrl}
              onChange={(e) => setSlackWebhookUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              aria-invalid={webhookInvalid}
            />
            <p className="text-xs text-muted-foreground">
              대량 재고 조정 시 알림이 전송됩니다 (https://hooks.slack.com/... 형식)
            </p>
            {webhookInvalid && (
              <p className="text-xs text-destructive">
                URL은 https://hooks.slack.com/ 으로 시작해야 합니다
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Section 3: 초기 셋업 가이드 ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>초기 셋업 가이드</CardTitle>
          <CardDescription>통합 재고 관리를 시작하려면 아래 순서를 따라주세요</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                1
              </span>
              <div className="flex-1">
                <p className="font-medium">위치 관리에서 보관 장소를 만드세요</p>
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <Link href="/d/inventory-mgmt/locations">위치 관리로 이동 →</Link>
                </Button>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                2
              </span>
              <div className="flex-1">
                <p className="font-medium">
                  입출고 관리에서 첫 입고를 등록하세요 (상품/옵션 자동 생성)
                </p>
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <Link href="/d/inventory-mgmt/movements">입출고 관리로 이동 →</Link>
                </Button>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                3
              </span>
              <div className="flex-1">
                <p className="font-medium">판매 채널 관리에서 출고용 채널을 등록하세요</p>
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <Link href="/d/inventory-mgmt/channels">판매 채널 관리로 이동 →</Link>
                </Button>
              </div>
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* ─── 저장 ─────────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving || webhookInvalid}>
          {saving ? '저장 중...' : '저장'}
        </Button>
      </div>
    </div>
  )
}
