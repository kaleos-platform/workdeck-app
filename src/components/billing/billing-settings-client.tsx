'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Info,
  Loader2,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { DECK_META, type DeckVariant } from '@/lib/deck-meta'
import { cn } from '@/lib/utils'

type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
type SubscriptionItemStatus = 'ACTIVE' | 'CANCEL_AT_PERIOD_END' | 'ENDED'
type PricingMode = 'FREE_BETA' | 'SUBSCRIPTION'
type ChargeStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUNDED'
type DeckAccessReason = 'FREE_BETA' | 'EXEMPT' | 'SUBSCRIBED' | 'TRIAL' | 'GRACE' | 'LOCKED'

interface BillingProduct {
  id: string
  name: string
  pricingMode: PricingMode
  monthlyPrice: number
  paidActivatedAt: string | null
  isActive: boolean
}

interface SubscriptionItemDto {
  id: string
  deckAppId: string
  priceSnapshot: number
  status: SubscriptionItemStatus
}

interface SubscriptionDto {
  status: SubscriptionStatus
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  exemptFlag: boolean
  items: SubscriptionItemDto[]
}

interface MethodDto {
  cardSummary: string | null
  createdAt: string
}

interface ChargeBreakdownLine {
  deckAppId: string
  type: string
  price: number
  prorated?: boolean
}

interface ChargeDto {
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

interface DeckAccessDto {
  allowed: boolean
  reason: DeckAccessReason
  graceEndsAt?: string | null
}

interface EntitlementDto {
  allowedDecks: string[]
  lockedDecks: string[]
  decks: Record<string, DeckAccessDto>
}

interface OverviewDto {
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

function formatWon(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function daysUntil(value: string | null): number | null {
  if (!value) return null
  const diffMs = new Date(value).getTime() - Date.now()
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000))
}

function loadTossSdk(): Promise<void> {
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

const CHARGE_STATUS_LABEL: Record<
  ChargeStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  PENDING: { label: '처리중', variant: 'secondary' },
  PAID: { label: '결제완료', variant: 'default' },
  FAILED: { label: '실패', variant: 'destructive' },
  CANCELED: { label: '취소됨', variant: 'outline' },
  REFUNDED: { label: '환불됨', variant: 'outline' },
}

const REASON_BADGE: Partial<Record<DeckAccessReason, { label: string; className: string }>> = {
  GRACE: {
    label: '유예 중',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  TRIAL: {
    label: 'Trial 이용 중',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  },
}

export function BillingSettingsClient({
  cardRegistered,
  initialError,
}: {
  cardRegistered: string | null
  initialError: string | null
}) {
  const [data, setData] = useState<OverviewDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [cardBusy, setCardBusy] = useState(false)
  const [selectedDecks, setSelectedDecks] = useState<string[]>([])
  const [startBusy, setStartBusy] = useState(false)
  const [deckBusyId, setDeckBusyId] = useState<string | null>(null)

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

  useEffect(() => {
    if (cardRegistered) {
      setBanner({ type: 'success', message: '카드 등록이 완료되었습니다' })
    } else if (initialError) {
      setBanner({ type: 'error', message: initialError })
    }
  }, [cardRegistered, initialError])

  const isOwner = data?.role === 'OWNER'

  const handleRegisterCard = useCallback(async () => {
    setCardBusy(true)
    setBanner(null)
    try {
      const res = await fetch('/api/billing/setup', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setBanner({ type: 'error', message: json?.error ?? '카드 등록 준비에 실패했습니다' })
        return
      }
      const { customerKey, clientKey } = json as { customerKey: string; clientKey: string }
      await loadTossSdk()
      if (!window.TossPayments) throw new Error('결제 SDK 로드에 실패했습니다')
      const toss = window.TossPayments(clientKey)
      const origin = window.location.origin
      await toss.payment({ customerKey }).requestBillingAuth({
        method: 'CARD',
        successUrl: `${origin}/api/billing/toss/callback`,
        failUrl: `${origin}/settings/billing?error=${encodeURIComponent('카드등록취소')}`,
      })
    } catch (e) {
      setBanner({
        type: 'error',
        message: e instanceof Error ? e.message : '카드 등록에 실패했습니다',
      })
    } finally {
      setCardBusy(false)
    }
  }, [])

  const toggleDeckSelection = useCallback((deckId: string) => {
    setSelectedDecks((prev) =>
      prev.includes(deckId) ? prev.filter((d) => d !== deckId) : [...prev, deckId]
    )
  }, [])

  const handleStartSubscription = useCallback(async () => {
    if (selectedDecks.length === 0) return
    setStartBusy(true)
    setBanner(null)
    try {
      const res = await fetch('/api/billing/subscription/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckIds: selectedDecks }),
      })
      const json = await res.json()
      if (!res.ok) {
        setBanner({ type: 'error', message: json?.error ?? '구독 시작에 실패했습니다' })
        return
      }
      setBanner({ type: 'success', message: '구독이 시작되었습니다' })
      setSelectedDecks([])
      await load()
    } catch {
      setBanner({ type: 'error', message: '구독 시작에 실패했습니다' })
    } finally {
      setStartBusy(false)
    }
  }, [selectedDecks, load])

  const handleAddDeck = useCallback(
    async (deckAppId: string) => {
      setDeckBusyId(deckAppId)
      setBanner(null)
      try {
        const res = await fetch('/api/billing/subscription/decks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deckAppId }),
        })
        const json = await res.json()
        if (!res.ok) {
          setBanner({ type: 'error', message: json?.error ?? 'deck 추가에 실패했습니다' })
          return
        }
        const { prorated, amount } = json as { prorated: boolean; amount: number }
        setBanner({
          type: 'success',
          message: prorated
            ? `deck이 추가되었습니다 (일할 결제 ${formatWon(amount)})`
            : 'deck 구독이 재개되었습니다',
        })
        await load()
      } catch {
        setBanner({ type: 'error', message: 'deck 추가에 실패했습니다' })
      } finally {
        setDeckBusyId(null)
      }
    },
    [load]
  )

  const handleCancelDeck = useCallback(
    async (deckAppId: string) => {
      setDeckBusyId(deckAppId)
      setBanner(null)
      try {
        const res = await fetch('/api/billing/subscription/decks', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deckAppId }),
        })
        const json = await res.json()
        if (!res.ok) {
          setBanner({ type: 'error', message: json?.error ?? 'deck 해제에 실패했습니다' })
          return
        }
        const { effectiveAt } = json as { effectiveAt: string | null }
        setBanner({
          type: 'success',
          message: `해제가 예약되었습니다. ${formatDate(effectiveAt)}까지 계속 이용할 수 있습니다`,
        })
        await load()
      } catch {
        setBanner({ type: 'error', message: 'deck 해제에 실패했습니다' })
      } finally {
        setDeckBusyId(null)
      }
    },
    [load]
  )

  const subscribableProducts = useMemo(
    () => data?.products.filter((p) => p.pricingMode === 'SUBSCRIPTION') ?? [],
    [data]
  )

  const selectionTotal = useMemo(() => {
    const supply = subscribableProducts
      .filter((p) => selectedDecks.includes(p.id))
      .reduce((sum, p) => sum + p.monthlyPrice, 0)
    return { supply, withVat: Math.round(supply * 1.1) }
  }, [subscribableProducts, selectedDecks])

  const monthlyTotal = useMemo(() => {
    if (!data?.subscription) return 0
    return data.subscription.items
      .filter((i) => i.status === 'ACTIVE')
      .reduce((sum, i) => sum + i.priceSnapshot, 0)
  }, [data])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        불러오는 중...
      </div>
    )
  }

  if (error || !data) {
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>구독 정보를 불러오지 못했습니다</AlertTitle>
        <AlertDescription>{error ?? '알 수 없는 오류가 발생했습니다'}</AlertDescription>
      </Alert>
    )
  }

  const { subscription, method, charges, entitlement } = data
  const trialDaysLeft = daysUntil(subscription?.trialEndsAt ?? null)
  const needsSubscriptionStart =
    !subscription ||
    subscription.status === 'TRIALING' ||
    subscription.status === 'EXPIRED' ||
    subscription.status === 'CANCELED'

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {banner && (
          <Alert variant={banner.type === 'error' ? 'destructive' : 'default'}>
            {banner.type === 'error' ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            <AlertTitle>{banner.message}</AlertTitle>
          </Alert>
        )}

        {!isOwner && (
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>결제 관리는 소유자만 가능합니다</AlertTitle>
            <AlertDescription>
              구독 현황은 열람할 수 있지만 변경은 소유자에게 요청하세요.
            </AlertDescription>
          </Alert>
        )}

        {/* 상태 요약 카드 */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>구독 상태</CardTitle>
              <CardDescription>워크덱 deck 이용 현황을 확인하세요.</CardDescription>
            </div>
            {data.subscription?.exemptFlag && <Badge variant="secondary">무료 이용 중</Badge>}
          </CardHeader>
          <CardContent className="space-y-3">
            {!subscription && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4" />
                아직 구독을 시작하지 않았습니다.
              </div>
            )}
            {subscription?.status === 'TRIALING' && (
              <div className="flex items-center gap-2 text-sm">
                <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                  Trial
                </Badge>
                <span>
                  {trialDaysLeft !== null && trialDaysLeft >= 0
                    ? `Trial 종료까지 ${trialDaysLeft}일 남았습니다 (${formatDate(subscription.trialEndsAt)})`
                    : `Trial이 종료되었습니다 (${formatDate(subscription.trialEndsAt)})`}
                </span>
              </div>
            )}
            {subscription?.status === 'ACTIVE' && (
              <div className="flex items-center gap-2 text-sm">
                <Badge>구독 중</Badge>
                <span>
                  다음 결제일 {formatDate(subscription.currentPeriodEnd)} · 월{' '}
                  {formatWon(Math.round(monthlyTotal * 1.1))} (VAT 포함)
                </span>
              </div>
            )}
            {subscription?.status === 'PAST_DUE' && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                결제에 실패했습니다. 결제수단을 확인해주세요.
              </div>
            )}
            {(subscription?.status === 'EXPIRED' || subscription?.status === 'CANCELED') && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4" />
                구독이 {subscription.status === 'EXPIRED' ? '만료' : '해지'}되었습니다. 다시 구독을
                시작할 수 있습니다.
              </div>
            )}
          </CardContent>
        </Card>

        {/* 결제수단 카드 */}
        <Card>
          <CardHeader>
            <CardTitle>결제수단</CardTitle>
            <CardDescription>정기 결제에 사용되는 카드입니다.</CardDescription>
          </CardHeader>
          <CardContent>
            {method ? (
              <div className="flex items-center gap-2 text-sm">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <span>{method.cardSummary ?? '등록된 카드'}</span>
                <span className="text-muted-foreground">· {formatDate(method.createdAt)} 등록</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4" />
                등록된 결제수단이 없습니다.
              </div>
            )}
          </CardContent>
          {isOwner && (
            <CardFooter>
              <Button
                onClick={handleRegisterCard}
                disabled={cardBusy}
                variant={method ? 'outline' : 'default'}
              >
                {cardBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {method ? '카드 변경' : '카드 등록'}
              </Button>
            </CardFooter>
          )}
        </Card>

        {/* deck 목록 카드 그리드 */}
        <Card>
          <CardHeader>
            <CardTitle>Deck별 구독</CardTitle>
            <CardDescription>
              사용 중인 deck과 요금을 확인하고 관리하세요. 표시 금액은 공급가이며 VAT는 별도입니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.products.map((product) => {
                const meta = DECK_META[product.id as DeckVariant]
                const Icon = meta?.icon
                const item = subscription?.items.find((i) => i.deckAppId === product.id)
                const access = entitlement.decks[product.id]
                const reasonBadge = access?.reason ? REASON_BADGE[access.reason] : undefined
                const busy = deckBusyId === product.id

                return (
                  <div key={product.id} className="flex flex-col gap-3 rounded-lg border p-4">
                    <div className="flex items-center gap-2.5">
                      {Icon && (
                        <div
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-white',
                            meta.gradient
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {meta?.name ?? product.name}
                        </div>
                        {product.pricingMode === 'SUBSCRIPTION' && (
                          <div className="text-xs text-muted-foreground">
                            월 {formatWon(product.monthlyPrice)}
                            <span className="ml-1">(VAT 별도)</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {product.pricingMode === 'FREE_BETA' ? (
                      <Badge variant="secondary" className="w-fit">
                        무료 베타
                      </Badge>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {reasonBadge && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge className={cn('w-fit', reasonBadge.className)}>
                                {reasonBadge.label}
                              </Badge>
                            </TooltipTrigger>
                            {access?.reason === 'GRACE' && access.graceEndsAt && (
                              <TooltipContent>
                                유료 전환 유예 중입니다. {formatDate(access.graceEndsAt)}까지 계속
                                사용할 수 있습니다.
                              </TooltipContent>
                            )}
                          </Tooltip>
                        )}

                        {item?.status === 'ACTIVE' && (
                          <>
                            <Badge variant="outline" className="w-fit">
                              구독 중
                            </Badge>
                            {isOwner && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="ml-auto"
                                disabled={busy}
                                onClick={() => handleCancelDeck(product.id)}
                              >
                                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                                해제
                              </Button>
                            )}
                          </>
                        )}

                        {item?.status === 'CANCEL_AT_PERIOD_END' && (
                          <>
                            <Badge
                              variant="outline"
                              className="w-fit text-amber-700 dark:text-amber-400"
                            >
                              기간말 해제 예정
                            </Badge>
                            {isOwner && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="ml-auto"
                                disabled={busy}
                                onClick={() => handleAddDeck(product.id)}
                              >
                                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                                재개
                              </Button>
                            )}
                          </>
                        )}

                        {!item && subscription?.status === 'ACTIVE' && isOwner && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-auto"
                            disabled={busy || !method}
                            onClick={() => handleAddDeck(product.id)}
                          >
                            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                            추가
                          </Button>
                        )}

                        {!item && needsSubscriptionStart && isOwner && (
                          <div className="ml-auto flex items-center gap-1.5">
                            <Checkbox
                              id={`deck-select-${product.id}`}
                              checked={selectedDecks.includes(product.id)}
                              onCheckedChange={() => toggleDeckSelection(product.id)}
                            />
                            <label
                              htmlFor={`deck-select-${product.id}`}
                              className="text-xs text-muted-foreground"
                            >
                              선택
                            </label>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* 구독 시작 카드 */}
        {needsSubscriptionStart && isOwner && (
          <Card>
            <CardHeader>
              <CardTitle>구독 시작</CardTitle>
              <CardDescription>이용할 deck을 선택하고 구독을 시작하세요.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedDecks.length > 0 && (
                <div className="rounded-md bg-muted/50 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      선택 {selectedDecks.length}개 · 공급가 합계
                    </span>
                    <span>{formatWon(selectionTotal.supply)}</span>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between font-medium">
                    <span>VAT 포함 결제 예정액</span>
                    <span>{formatWon(selectionTotal.withVat)}</span>
                  </div>
                </div>
              )}
              {!method ? (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>카드를 먼저 등록해주세요</AlertTitle>
                  <AlertDescription>구독을 시작하려면 결제수단 등록이 필요합니다.</AlertDescription>
                </Alert>
              ) : (
                <Button
                  onClick={handleStartSubscription}
                  disabled={startBusy || selectedDecks.length === 0}
                >
                  {startBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  구독 시작
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* 결제 내역 */}
        <Card>
          <CardHeader>
            <CardTitle>결제 내역</CardTitle>
            <CardDescription>최근 결제 내역입니다. 금액은 VAT 포함입니다.</CardDescription>
          </CardHeader>
          <CardContent>
            {charges.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                결제 내역이 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>결제일</TableHead>
                      <TableHead>청구 기간</TableHead>
                      <TableHead>금액</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead>내역</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {charges.map((charge) => {
                      const statusMeta = CHARGE_STATUS_LABEL[charge.status]
                      return (
                        <TableRow key={charge.orderId}>
                          <TableCell className="whitespace-nowrap">
                            {formatDate(charge.createdAt)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatDate(charge.periodStart)} ~ {formatDate(charge.periodEnd)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatWon(charge.amount)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                              {charge.status === 'FAILED' && charge.failReason && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                                  </TooltipTrigger>
                                  <TooltipContent>{charge.failReason}</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {Array.isArray(charge.breakdown) && charge.breakdown.length > 0 ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help text-xs text-muted-foreground underline decoration-dotted">
                                    {charge.breakdown.length}개 항목
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <ul className="space-y-0.5">
                                    {charge.breakdown.map((line, idx) => {
                                      const meta = DECK_META[line.deckAppId as DeckVariant]
                                      return (
                                        <li key={`${line.deckAppId}-${idx}`}>
                                          {meta?.name ?? line.deckAppId} · {formatWon(line.price)}
                                          {line.prorated ? ' (일할)' : ''}
                                        </li>
                                      )
                                    })}
                                  </ul>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  )
}
