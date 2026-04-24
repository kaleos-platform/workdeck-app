'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SALES_CONTENT_CHANNELS_PATH } from '@/lib/deck-routes'

type Platform =
  | 'BLOG_NAVER'
  | 'BLOG_TISTORY'
  | 'BLOG_WORDPRESS'
  | 'THREADS'
  | 'X'
  | 'LINKEDIN'
  | 'FACEBOOK'
  | 'INSTAGRAM'
  | 'YOUTUBE_SHORTS'
  | 'OTHER'

type Kind = 'BLOG' | 'SOCIAL'
type PublisherMode = 'API' | 'BROWSER' | 'MANUAL'
type CollectorMode = 'API' | 'BROWSER' | 'MANUAL' | 'NONE'

type Mode = 'create' | 'edit'

type Props = {
  mode: Mode
  channelId?: string
  initial?: {
    name?: string
    platformSlug?: string
    platform?: Platform
    kind?: Kind
    publisherMode?: PublisherMode
    collectorMode?: CollectorMode
    isActive?: boolean
  }
}

const PLATFORM_OPTIONS: { value: Platform; label: string; defaultKind: Kind }[] = [
  { value: 'BLOG_NAVER', label: '네이버 블로그', defaultKind: 'BLOG' },
  { value: 'BLOG_TISTORY', label: '티스토리', defaultKind: 'BLOG' },
  { value: 'BLOG_WORDPRESS', label: '워드프레스', defaultKind: 'BLOG' },
  { value: 'THREADS', label: 'Threads', defaultKind: 'SOCIAL' },
  { value: 'X', label: 'X (Twitter)', defaultKind: 'SOCIAL' },
  { value: 'LINKEDIN', label: 'LinkedIn', defaultKind: 'SOCIAL' },
  { value: 'FACEBOOK', label: 'Facebook', defaultKind: 'SOCIAL' },
  { value: 'INSTAGRAM', label: 'Instagram', defaultKind: 'SOCIAL' },
  { value: 'YOUTUBE_SHORTS', label: 'YouTube Shorts', defaultKind: 'SOCIAL' },
  { value: 'OTHER', label: '기타', defaultKind: 'BLOG' },
]

export function ChannelForm({ mode, channelId, initial }: Props) {
  const router = useRouter()
  const [name, setName] = useState(initial?.name ?? '')
  const [platformSlug, setPlatformSlug] = useState(initial?.platformSlug ?? '')
  const [platform, setPlatform] = useState<Platform>(initial?.platform ?? 'BLOG_NAVER')
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'BLOG')
  const [publisherMode, setPublisherMode] = useState<PublisherMode>(
    initial?.publisherMode ?? 'MANUAL'
  )
  const [collectorMode, setCollectorMode] = useState<CollectorMode>(
    initial?.collectorMode ?? 'MANUAL'
  )
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function onPlatformChange(p: Platform) {
    setPlatform(p)
    const matched = PLATFORM_OPTIONS.find((o) => o.value === p)
    if (matched) setKind(matched.defaultKind)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const url = mode === 'create' ? '/api/sc/channels' : `/api/sc/channels/${channelId}`
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          platformSlug,
          platform,
          kind,
          publisherMode,
          collectorMode,
          isActive,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? '저장에 실패했습니다')
        return
      }
      router.push(SALES_CONTENT_CHANNELS_PATH)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {mode === 'create' ? '새 배포 채널' : '채널 편집'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">이름</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="platformSlug">slug (utm_source)</Label>
              <Input
                id="platformSlug"
                value={platformSlug}
                onChange={(e) => setPlatformSlug(e.target.value)}
                required
                placeholder="naver-main-blog"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>플랫폼</Label>
              <Select value={platform} onValueChange={(v) => onPlatformChange(v as Platform)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>종류 (utm_medium)</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BLOG">블로그</SelectItem>
                  <SelectItem value="SOCIAL">소셜</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>배포 방식</Label>
              <Select
                value={publisherMode}
                onValueChange={(v) => setPublisherMode(v as PublisherMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="API">API</SelectItem>
                  <SelectItem value="BROWSER">브라우저 자동화</SelectItem>
                  <SelectItem value="MANUAL">수동</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>수집 방식</Label>
              <Select
                value={collectorMode}
                onValueChange={(v) => setCollectorMode(v as CollectorMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="API">API</SelectItem>
                  <SelectItem value="BROWSER">브라우저 자동화</SelectItem>
                  <SelectItem value="MANUAL">수동 입력</SelectItem>
                  <SelectItem value="NONE">수집 안 함</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              활성
            </label>
            <Button type="submit" disabled={submitting}>
              {submitting ? '저장 중…' : mode === 'create' ? '생성' : '저장'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
