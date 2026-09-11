'use client'

import { useCallback, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldAlert, XCircle } from 'lucide-react'
import { DECK_META, type DeckVariant } from '@/lib/deck-meta'
import { cn } from '@/lib/utils'
import {
  REASON_BADGE,
  daysUntil,
  formatDate,
  formatWon,
  useBillingOverview,
} from './billing-shared'

export function SubscriptionSettingsClient() {
  const { data, loading, error, banner, setBanner, load, isOwner } = useBillingOverview()
  const [selectedDecks, setSelectedDecks] = useState<string[]>([])
  const [startBusy, setStartBusy] = useState(false)
  const [deckBusyId, setDeckBusyId] = useState<string | null>(null)

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
          setBanner({ type: 'error', message: json?.error ?? '업무 추가에 실패했습니다' })
          return
        }
        const { prorated, amount } = json as { prorated: boolean; amount: number }
        setBanner({
          type: 'success',
          message: prorated
            ? `추가되었습니다 (일할 결제 ${formatWon(amount)})`
            : '구독이 재개되었습니다',
        })
        await load()
      } catch {
        setBanner({ type: 'error', message: '업무 추가에 실패했습니다' })
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
          setBanner({ type: 'error', message: json?.error ?? '해제에 실패했습니다' })
          return
        }
        const { effectiveAt } = json as { effectiveAt: string | null }
        setBanner({
          type: 'success',
          message: `해제가 예약되었습니다. ${formatDate(effectiveAt)}까지 계속 이용할 수 있습니다`,
        })
        await load()
      } catch {
        setBanner({ type: 'error', message: '해제에 실패했습니다' })
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

  const { subscription, method, entitlement } = data
  const trialDaysLeft = daysUntil(subscription?.trialEndsAt ?? null)
  // 유료 전환된 업무가 하나도 없으면 구독 자체가 성립하지 않는다 (전 업무 무료 제공 중)
  const hasSubscribableProduct = subscribableProducts.length > 0
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
              <CardDescription>워크덱 업무 이용 현황을 확인하세요.</CardDescription>
            </div>
            {data.subscription?.exemptFlag && <Badge variant="secondary">무료 이용 중</Badge>}
          </CardHeader>
          <CardContent className="space-y-3">
            {/* 구독 이력이 없거나, 면제 백필로 생긴 빈 TRIALING 행(trialEndsAt 없음)일 때 */}
            {(!subscription ||
              (subscription.status === 'TRIALING' && !subscription.trialEndsAt)) && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4" />
                {hasSubscribableProduct
                  ? '아직 구독을 시작하지 않았습니다.'
                  : '현재 모든 업무를 무료로 제공하고 있습니다. 유료 청구가 시작되기 전에 미리 안내드립니다.'}
              </div>
            )}
            {subscription?.status === 'TRIALING' && subscription.trialEndsAt && (
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

        {/* 업무 목록 카드 그리드 */}
        <Card>
          <CardHeader>
            <CardTitle>업무별 구독</CardTitle>
            <CardDescription>
              사용 중인 업무와 요금을 확인하고 관리하세요. 표시 금액은 VAT가 포함된 실제 결제
              금액입니다.
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
                            meta?.gradient ?? 'from-slate-400 to-slate-600'
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {meta?.name ?? product.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          월 {formatWon(Math.round(product.monthlyPrice * 1.1))}
                          <span className="ml-1">
                            (VAT 포함 / 공급가 {formatWon(product.monthlyPrice)})
                          </span>
                        </div>
                      </div>
                    </div>

                    {product.pricingMode === 'FREE_BETA' ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="secondary" className="w-fit">
                            현재 무료 제공 중
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          정식 구독료는 월 {formatWon(Math.round(product.monthlyPrice * 1.1))}
                          입니다. 유료 청구 시작 전에 미리 안내드립니다.
                        </TooltipContent>
                      </Tooltip>
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

                        {!item && needsSubscriptionStart && isOwner && hasSubscribableProduct && (
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
        {needsSubscriptionStart && isOwner && hasSubscribableProduct && (
          <Card>
            <CardHeader>
              <CardTitle>구독 시작</CardTitle>
              <CardDescription>이용할 업무를 선택하고 구독을 시작하세요.</CardDescription>
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
      </div>
    </TooltipProvider>
  )
}
