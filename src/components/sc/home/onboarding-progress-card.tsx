'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Circle, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import {
  SALES_CONTENT_BRAND_PROFILE_PATH,
  SALES_CONTENT_CHANNELS_PATH,
  SALES_CONTENT_ONBOARDING_PATH,
  SALES_CONTENT_PERSONAS_PATH,
  SALES_CONTENT_PRODUCTS_PATH,
} from '@/lib/deck-routes'

type Counts = {
  brandProfile: number
  products: number
  personas: number
  channels: number
  resources: number
}

type Status = {
  counts: Counts
  completed: boolean
  dismissed: boolean
}

type Item = {
  key: keyof Omit<Counts, 'resources'>
  title: string
  path: string
}

const ITEMS: Item[] = [
  { key: 'brandProfile', title: '브랜드 프로필 작성', path: SALES_CONTENT_BRAND_PROFILE_PATH },
  { key: 'products', title: '상품 등록', path: SALES_CONTENT_PRODUCTS_PATH },
  { key: 'personas', title: '타겟 페르소나 등록', path: SALES_CONTENT_PERSONAS_PATH },
  { key: 'channels', title: '배포 채널 등록', path: SALES_CONTENT_CHANNELS_PATH },
]

export function OnboardingProgressCard() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [dismissing, setDismissing] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sc/onboarding/status', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as Status
      setStatus(data)
    } catch {
      // 진행률 카드는 부가기능 — 실패 시 표시하지 않고 침묵
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 사용자가 다른 탭에서 항목 등록 후 돌아오면 카운트 갱신
  useEffect(() => {
    const onFocus = () => {
      void load()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  async function handleDismiss() {
    setDismissing(true)
    try {
      const res = await fetch('/api/sc/onboarding/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true }),
      })
      if (!res.ok) throw new Error('닫기 실패')
      setStatus((prev) => (prev ? { ...prev, dismissed: true } : prev))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '닫기 실패')
    } finally {
      setDismissing(false)
    }
  }

  if (loading) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <div className="h-5 w-32 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent>
          <div className="h-2 w-full animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    )
  }

  if (!status || status.completed || status.dismissed) return null

  const completedCount = ITEMS.reduce((acc, it) => acc + (status.counts[it.key] >= 1 ? 1 : 0), 0)
  if (completedCount === ITEMS.length) return null
  const percent = Math.round((completedCount / ITEMS.length) * 100)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">
            시작하기 — {completedCount}/{ITEMS.length} 완료
          </CardTitle>
          <CardDescription>
            세일즈 콘텐츠 제작을 시작하기 위해 필요한 항목을 등록하세요
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDismiss}
          disabled={dismissing}
          aria-label="온보딩 카드 닫기"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={percent} className="h-2" />
        <ul className="divide-y">
          {ITEMS.map((item) => {
            const count = status.counts[item.key]
            const done = count >= 1
            return (
              <li
                key={item.key}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {done ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />
                  )}
                  <span className={cn('font-medium', done && 'text-muted-foreground')}>
                    {item.title}
                  </span>
                </div>
                <Button asChild size="sm" variant={done ? 'ghost' : 'outline'} className="shrink-0">
                  <Link href={item.path}>{done ? '관리' : '등록하기'}</Link>
                </Button>
              </li>
            )
          })}
        </ul>
        <Button asChild variant="secondary" className="w-full">
          <Link href={SALES_CONTENT_ONBOARDING_PATH}>위저드에서 계속</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
