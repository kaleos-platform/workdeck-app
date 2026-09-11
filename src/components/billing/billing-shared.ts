'use client'

import { useCallback, useEffect, useState } from 'react'

// 구독 관리(/settings/billing)와 결제 관리(/settings/payments)가 공유하는
// 타입·포맷터·오버뷰 로딩. 두 화면 모두 GET /api/billing/overview 한 번으로 충분하다.

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
export type SubscriptionItemStatus = 'ACTIVE' | 'CANCEL_AT_PERIOD_END' | 'ENDED'
export type PricingMode = 'FREE_BETA' | 'SUBSCRIPTION'
export type ChargeStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUNDED'
export type DeckAccessReason = 'FREE_BETA' | 'EXEMPT' | 'SUBSCRIBED' | 'TRIAL' | 'GRACE' | 'LOCKED'

export interface BillingProduct {
  id: string
  name: string
  pricingMode: PricingMode
  monthlyPrice: number
  paidActivatedAt: string | null
  isActive: boolean
}

export interface SubscriptionItemDto {
  id: string
  deckAppId: string
  priceSnapshot: number
  status: SubscriptionItemStatus
}

export interface SubscriptionDto {
  status: SubscriptionStatus
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  exemptFlag: boolean
  items: SubscriptionItemDto[]
}

export interface MethodDto {
  cardSummary: string | null
  createdAt: string
}

export interface ChargeBreakdownLine {
  deckAppId: string
  type: string
  price: number
  prorated?: boolean
}

export interface ChargeDto {
  orderId: string
  amount: number
  supplyAmount: number
  vatAmount: number
  status: ChargeStatus
  failReason: string | null
  periodStart: string
  periodEnd: string
  breakdown: ChargeBreakdownLine[]
  createdAt: string
}

export interface DeckAccessDto {
  allowed: boolean
  reason: DeckAccessReason
  graceEndsAt?: string | null
}

export interface EntitlementDto {
  allowedDecks: string[]
  lockedDecks: string[]
  decks: Record<string, DeckAccessDto>
}

export interface OverviewDto {
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  products: BillingProduct[]
  subscription: SubscriptionDto | null
  method: MethodDto | null
  charges: ChargeDto[]
  entitlement: EntitlementDto
}

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => {
      payment: (opts: { customerKey: string }) => {
        requestBillingAuth: (opts: {
          method: 'CARD'
          successUrl: string
          failUrl: string
        }) => Promise<void>
      }
    }
  }
}

const TOSS_SDK_URL = 'https://js.tosspayments.com/v2/standard'

export function formatWon(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`
}

export function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function daysUntil(value: string | null): number | null {
  if (!value) return null
  const diffMs = new Date(value).getTime() - Date.now()
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000))
}

export function loadTossSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('브라우저 환경이 아닙니다'))
  if (window.TossPayments) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = TOSS_SDK_URL
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('결제 SDK 로드에 실패했습니다'))
    document.head.appendChild(script)
  })
}

export const CHARGE_STATUS_LABEL: Record<
  ChargeStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  PENDING: { label: '처리중', variant: 'secondary' },
  PAID: { label: '결제완료', variant: 'default' },
  FAILED: { label: '실패', variant: 'destructive' },
  CANCELED: { label: '취소됨', variant: 'outline' },
  REFUNDED: { label: '환불됨', variant: 'outline' },
}

export const REASON_BADGE: Partial<Record<DeckAccessReason, { label: string; className: string }>> =
  {
    GRACE: {
      label: '유예 중',
      className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    },
    TRIAL: {
      label: 'Trial 이용 중',
      className: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
    },
  }

export type Banner = { type: 'success' | 'error'; message: string } | null

/** 오버뷰 로딩 + 배너 상태 — 두 화면이 같은 엔드포인트를 쓰므로 한 곳에 둔다. */
export function useBillingOverview() {
  const [data, setData] = useState<OverviewDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<Banner>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/billing/overview')
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error ?? '구독 정보를 불러오지 못했습니다')
        return
      }
      setData(json as OverviewDto)
    } catch {
      setError('구독 정보를 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, error, banner, setBanner, load, isOwner: data?.role === 'OWNER' }
}
