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
  SELLER_HUB_BRANDS_PATH,
  SELLER_HUB_CHANNELS_PATH,
  SELLER_HUB_LOCATIONS_PATH,
  SELLER_HUB_PRODUCTS_LIST_PATH,
  SELLER_HUB_PRODUCT_NEW_PATH,
  SELLER_HUB_SHIPPING_METHODS_PATH,
} from '@/lib/deck-routes'

type Counts = {
  brand: number
  product: number
  channel: number
  location: number
  shippingMethod: number
}

type Status = {
  counts: Counts
  completed: boolean
  dismissed: boolean
}

type Item = {
  key: keyof Counts
  title: string
  addPath: string
  managePath: string
}

const ITEMS: Item[] = [
  {
    key: 'brand',
    title: '브랜드 등록',
    addPath: SELLER_HUB_BRANDS_PATH,
    managePath: SELLER_HUB_BRANDS_PATH,
  },
  {
    key: 'product',
    title: '상품 등록',
    addPath: SELLER_HUB_PRODUCT_NEW_PATH,
    managePath: SELLER_HUB_PRODUCTS_LIST_PATH,
  },
  {
    key: 'channel',
    title: '판매 채널 등록',
    addPath: SELLER_HUB_CHANNELS_PATH,
    managePath: SELLER_HUB_CHANNELS_PATH,
  },
  {
    key: 'location',
    title: '재고 위치 등록',
    addPath: SELLER_HUB_LOCATIONS_PATH,
    managePath: SELLER_HUB_LOCATIONS_PATH,
  },
  {
    key: 'shippingMethod',
    title: '배송 방식 등록',
    addPath: SELLER_HUB_SHIPPING_METHODS_PATH,
    managePath: SELLER_HUB_SHIPPING_METHODS_PATH,
  },
]

export function OnboardingProgressCard() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [dismissing, setDismissing] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sh/onboarding-status', { cache: 'no-store' })
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
      const res = await fetch('/api/sh/onboarding-status', {
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
  const percent = Math.round((completedCount / ITEMS.length) * 100)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">
            시작하기 — {completedCount}/{ITEMS.length} 완료
          </CardTitle>
          <CardDescription>브랜드 운영을 시작하기 위해 필요한 항목을 등록하세요</CardDescription>
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
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className={cn('font-medium', done && 'text-muted-foreground')}>
                      {item.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {done ? `${count}개` : '아직 없음'}
                    </span>
                  </div>
                </div>
                <Button asChild size="sm" variant={done ? 'ghost' : 'outline'} className="shrink-0">
                  <Link href={done ? item.managePath : item.addPath}>
                    {done ? '관리' : '추가하기'}
                  </Link>
                </Button>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
