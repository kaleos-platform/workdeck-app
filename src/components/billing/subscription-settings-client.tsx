'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldAlert, XCircle } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { SETTINGS_BILLING_PATH } from '@/lib/deck-routes'
import { DECK_META, type DeckVariant } from '@/lib/deck-meta'
import { cn } from '@/lib/utils'
import { SubscribeDialog, type SubscribeTarget } from './subscribe-dialog'
import { TrialDdayBadge } from './trial-dday-badge'
import {
  REASON_BADGE,
  discountNote,
  endsAtPeriodEnd,
  nextCycleSupplyTotal,
  formatDate,
  formatTrialEndDate,
  formatWon,
  useBillingOverview,
} from './billing-shared'

export function SubscriptionSettingsClient() {
  const { data, loading, error, banner, setBanner, load, isOwner } = useBillingOverview()
  const [startBusy, setStartBusy] = useState(false)
  const [deckBusyId, setDeckBusyId] = useState<string | null>(null)
  const [pending, setPending] = useState<SubscribeTarget | null>(null)
  const [cancelTarget, setCancelTarget] = useState<{
    id: string
    name: string
    reserved: boolean
  } | null>(null)
  const searchParams = useSearchParams()

  const runStartSubscription = useCallback(
    async (deckIds: string[]) => {
      if (deckIds.length === 0) return
      setStartBusy(true)
      setBanner(null)
      try {
        const res = await fetch('/api/billing/subscription/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deckIds }),
        })
        const json = await res.json()
        if (!res.ok) {
          setBanner({
            type: 'error',
            message: json?.message ?? json?.error ?? '구독 시작에 실패했습니다',
          })
          return
        }
        setBanner({
          type: 'success',
          message: (json as { reserved?: boolean }).reserved
            ? '구독을 예약했습니다. 체험이 끝나는 날 첫 결제가 진행됩니다'
            : '구독이 시작되었습니다',
        })
        await load()
      } catch {
        setBanner({ type: 'error', message: '구독 시작에 실패했습니다' })
      } finally {
        setStartBusy(false)
      }
    },
    [load, setBanner]
  )

  const runAddDeck = useCallback(
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
          setBanner({
            type: 'error',
            message: json?.message ?? json?.error ?? '업무 추가에 실패했습니다',
          })
          return
        }
        const { prorated, amount, reserved } = json as {
          prorated: boolean
          amount: number
          reserved?: boolean
        }
        setBanner({
          type: 'success',
          message: reserved
            ? '구독을 예약했습니다. 체험이 끝나는 날 결제가 진행됩니다'
            : prorated
              ? `추가되었습니다 (일할 결제 ${formatWon(amount)})`
              : amount > 0
                ? `구독이 시작되었습니다 (결제 ${formatWon(amount)})`
                : '구독을 다시 시작했습니다',
        })
        await load()
      } catch {
        setBanner({ type: 'error', message: '업무 추가에 실패했습니다' })
      } finally {
        setDeckBusyId(null)
      }
    },
    [load, setBanner]
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
          setBanner({
            type: 'error',
            message: json?.message ?? json?.error ?? '해지에 실패했습니다',
          })
          return
        }
        const { effectiveAt, reservationCanceled } = json as {
          effectiveAt: string | null
          reservationCanceled?: boolean
        }
        setBanner({
          type: 'success',
          message: reservationCanceled
            ? '구독 예약을 취소했습니다. 결제되지 않습니다'
            : `해지가 예약되었습니다. ${formatDate(effectiveAt)}까지 계속 이용할 수 있습니다`,
        })
        await load()
      } catch {
        setBanner({ type: 'error', message: '해지에 실패했습니다' })
      } finally {
        setDeckBusyId(null)
      }
    },
    [load, setBanner]
  )

  /** 확인 모달을 연다. 실제 호출은 onConfirm 에서 일어난다. */
  const openSubscribeDialog = useCallback(
    (deckIds: string[], isAddition: boolean) => {
      const access = deckIds.length === 1 ? data?.entitlement.decks[deckIds[0]] : undefined
      const decks = (data?.products ?? [])
        .filter(
          (p) =>
            deckIds.includes(p.id) &&
            !data?.entitlement.decks[p.id]?.exempt &&
            !data?.subscription?.exemptFlag
        )
        .map((p) => ({
          id: p.id,
          name: p.name,
          monthlyPrice: p.effectivePrice,
          listPrice: p.monthlyPrice,
        }))
      if (decks.length === 0) return
      setPending({
        decks,
        isAddition,
        trialEndsAt: access?.reason === 'TRIAL' ? (access.trialEndsAt ?? null) : null,
      })
    },
    [data]
  )

  const confirmPending = useCallback(async () => {
    if (!pending) return
    if (pending.isAddition) {
      await runAddDeck(pending.decks[0].id)
    } else {
      await runStartSubscription(pending.decks.map((d) => d.id))
    }
    setPending(null)
  }, [pending, runAddDeck, runStartSubscription])

  // 카드 등록 왕복(?subscribe=) 후 돌아왔을 때 확인 단계를 이어서 연다.
  const subscribeParam = searchParams.get('subscribe')
  useEffect(() => {
    if (!subscribeParam || !data) return
    const ids = subscribeParam.split(',').filter(Boolean)
    const already = new Set(
      (data.subscription?.items ?? []).filter((i) => i.status === 'ACTIVE').map((i) => i.deckAppId)
    )
    const target = ids.filter((id) => !already.has(id))
    if (target.length === 0) return
    const isAddition =
      data.subscription?.status === 'ACTIVE' || data.subscription?.status === 'PAST_DUE'
    const decks = data.products
      .filter(
        (p) =>
          target.includes(p.id) &&
          p.pricingMode === 'SUBSCRIPTION' &&
          !p.comingSoon &&
          !data.entitlement.decks[p.id]?.exempt &&
          !data.subscription?.exemptFlag
      )
      .map((p) => ({
        id: p.id,
        name: p.name,
        monthlyPrice: p.effectivePrice,
        listPrice: p.monthlyPrice,
      }))
    if (decks.length === 0) return
    const access = decks.length === 1 ? data.entitlement.decks[decks[0].id] : undefined
    setPending({
      decks,
      isAddition,
      trialEndsAt: access?.reason === 'TRIAL' ? (access.trialEndsAt ?? null) : null,
    })
    // 한 번만 열리도록 파라미터 제거
    window.history.replaceState(null, '', window.location.pathname)
  }, [subscribeParam, data])

  const subscribableProducts = useMemo(
    () =>
      data?.products.filter(
        (p) =>
          p.pricingMode === 'SUBSCRIPTION' &&
          !p.comingSoon &&
          !data.entitlement.decks[p.id]?.exempt &&
          !data.subscription?.exemptFlag
      ) ?? [],
    [data]
  )

  const monthlyTotal = useMemo(
    () =>
      nextCycleSupplyTotal(
        data?.subscription?.items ?? [],
        data?.subscription?.currentPeriodEnd ?? null,
        (deckAppId) => data?.entitlement.decks[deckAppId]?.trialEndsAt
      ),
    [data]
  )
  // 결제된 업무 없이 체험 예약만 있는 구독 — 아직 결제 전이다
  const reservationOnly = useMemo(() => {
    const live = (data?.subscription?.items ?? []).filter((i) => i.status !== 'ENDED')
    return live.length > 0 && live.every((i) => i.awaitingTrialEnd)
  }, [data])
  const subscriptionEnding = useMemo(() => endsAtPeriodEnd(data?.subscription?.items ?? []), [data])

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
  // 유료 전환된 업무가 하나도 없으면 구독 자체가 성립하지 않는다 (전 업무 무료 제공 중)
  const hasSubscribableProduct = subscribableProducts.length > 0
  // 구독이 살아 있으면 업무 추가(일할·예약), 아니면 새 구독 시작
  const subscriptionLive = subscription?.status === 'ACTIVE' || subscription?.status === 'PAST_DUE'
  const checkoutPaused = Boolean(data.checkoutPaused)

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
            {data.subscription?.exemptFlag && <Badge variant="secondary">전체 Space 면제</Badge>}
          </CardHeader>
          <CardContent className="space-y-3">
            {(!subscription || subscription.status === 'TRIALING') && (
              <p className="text-sm text-muted-foreground">
                {data.products.some((p) => p.pricingMode === 'SUBSCRIPTION' && !p.comingSoon)
                  ? '업무별 체험 기간과 이용 상태를 아래에서 확인하세요. 체험 종료 후 자동 결제되지 않습니다. 체험 중에도 미리 구독할 수 있으며, 이때 결제는 체험이 끝나는 날 시작됩니다.'
                  : '현재 모든 업무를 무료로 제공하고 있습니다. 유료 청구가 시작되기 전에 미리 안내드립니다.'}
              </p>
            )}
            {subscription?.status === 'ACTIVE' && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant={subscriptionEnding || reservationOnly ? 'secondary' : 'default'}>
                  {subscriptionEnding ? '해지 예정' : reservationOnly ? '구독 예약' : '구독 중'}
                </Badge>
                <span>
                  {subscriptionEnding
                    ? `${formatDate(subscription.currentPeriodEnd)}까지 이용할 수 있으며, 이후 구독이 종료됩니다`
                    : reservationOnly
                      ? `첫 결제일 ${formatDate(subscription.currentPeriodEnd)} · 월 ${formatWon(Math.round(monthlyTotal * 1.1))} (VAT 포함) · 체험이 끝나면 결제됩니다`
                      : `다음 결제일 ${formatDate(subscription.currentPeriodEnd)} · 월 ${formatWon(Math.round(monthlyTotal * 1.1))} (VAT 포함)`}
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
                {subscription.status === 'CANCELED' && data.charges[0]?.status === 'REFUNDED'
                  ? '마지막 결제가 전액 취소되어 유료 구독이 종료되었습니다. 업무별 체험·면제 여부는 아래에서 확인하세요.'
                  : `구독이 ${subscription.status === 'EXPIRED' ? '만료' : '해지'}되었습니다. 다시 구독을 시작할 수 있습니다.`}
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
                const isExempt = access?.exempt || subscription?.exemptFlag
                const isReserved = item?.status === 'ACTIVE' && Boolean(item.awaitingTrialEnd)

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
                        {/* 준비중 업무는 판매 상품이 아니므로 가격을 보이지 않는다 */}
                        {!product.comingSoon && (
                          <div className="text-xs text-muted-foreground">
                            월 {formatWon(Math.round(product.effectivePrice * 1.1))}
                            <span className="ml-1">(VAT 포함)</span>
                          </div>
                        )}
                        {discountNote(product.monthlyPrice, product.effectivePrice) && (
                          <div className="text-xs text-primary">
                            {discountNote(product.monthlyPrice, product.effectivePrice)}
                          </div>
                        )}
                      </div>
                    </div>

                    {access?.trialEndsAt && (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {access.reason === 'LOCKED' ? '체험 종료' : '체험 종료일'}:{' '}
                        {formatTrialEndDate(access.trialEndsAt)} (KST)
                        {access.reason === 'LOCKED' && ' · 계속 이용하려면 유료 구독을 시작하세요.'}
                      </p>
                    )}

                    {product.comingSoon ? (
                      <Badge variant="secondary" className="w-fit">
                        준비중
                      </Badge>
                    ) : product.pricingMode === 'FREE_BETA' ? (
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
                        {reasonBadge && !isReserved && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge className={cn('w-fit', reasonBadge.className)}>
                                {reasonBadge.label}
                              </Badge>
                            </TooltipTrigger>
                            {access?.reason === 'GRACE' && access.graceEndsAt && (
                              <TooltipContent>
                                무료로 이용 중입니다. {formatDate(access.graceEndsAt)}까지 계속
                                사용할 수 있습니다.
                              </TooltipContent>
                            )}
                          </Tooltip>
                        )}

                        {access?.reason === 'TRIAL' && access.trialEndsAt && !item && (
                          <TrialDdayBadge trialEndsAt={access.trialEndsAt} />
                        )}

                        {item?.status === 'ACTIVE' && (
                          <>
                            <Badge variant="outline" className="w-fit">
                              {isReserved ? '구독 예약' : '구독 중'}
                            </Badge>
                            {isReserved && access?.trialEndsAt && (
                              <TrialDdayBadge trialEndsAt={access.trialEndsAt} reserved />
                            )}
                            {isOwner && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="ml-auto"
                                disabled={busy}
                                onClick={() =>
                                  setCancelTarget({
                                    id: product.id,
                                    name: meta?.name ?? product.name,
                                    reserved: isReserved,
                                  })
                                }
                              >
                                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                                {isReserved ? '예약 취소' : '해지'}
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
                              기간말 해지 예정
                            </Badge>
                            {isOwner && !isExempt && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="ml-auto"
                                disabled={busy}
                                onClick={() => openSubscribeDialog([product.id], true)}
                              >
                                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                                다시 시작
                              </Button>
                            )}
                          </>
                        )}

                        {/* 누르면 바로 구독 확인 모달 — 카드가 없으면 모달에서 카드 등록부터 */}
                        {!item && !isExempt && isOwner && hasSubscribableProduct && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-auto"
                            disabled={busy || checkoutPaused}
                            onClick={() => openSubscribeDialog([product.id], subscriptionLive)}
                          >
                            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                            {checkoutPaused ? '결제 준비 중' : '구독'}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <SubscribeDialog
        target={pending}
        cardSummary={method?.cardSummary ?? null}
        returnTo={`${SETTINGS_BILLING_PATH}?subscribe=${(pending?.decks ?? []).map((d) => d.id).join(',')}`}
        busy={startBusy || deckBusyId !== null}
        onCancel={() => setPending(null)}
        onConfirm={confirmPending}
      />

      <Dialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => !open && deckBusyId === null && setCancelTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {cancelTarget?.reserved ? '구독 예약을 취소할까요?' : '구독을 해지할까요?'}
            </DialogTitle>
            <DialogDescription>
              {cancelTarget?.reserved
                ? `${cancelTarget.name} 구독 예약을 취소합니다. 결제되지 않으며 체험 기간은 그대로 이용할 수 있습니다.`
                : `${cancelTarget?.name ?? ''} 구독을 해지하면 이미 결제한 이용 기간의 마지막 날까지는 그대로 사용할 수 있고, 다음 주기부터 요금이 청구되지 않습니다. 기존 데이터는 삭제되지 않습니다.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCancelTarget(null)}
              disabled={deckBusyId !== null}
            >
              돌아가기
            </Button>
            <Button
              variant="destructive"
              disabled={!cancelTarget || deckBusyId !== null}
              onClick={async () => {
                if (!cancelTarget) return
                await handleCancelDeck(cancelTarget.id)
                setCancelTarget(null)
              }}
            >
              {deckBusyId !== null && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {cancelTarget?.reserved ? '예약 취소' : '구독 해지'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}
