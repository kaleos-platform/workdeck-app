'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ExternalLink, PlusCircle } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { SubscribeDialog, type SubscribeTarget } from '@/components/billing/subscribe-dialog'
import {
  COUPANG_ADS_BASE_PATH,
  SELLER_HUB_BASE_PATH,
  SALES_CONTENT_BASE_PATH,
} from '@/lib/deck-routes'
import { DECK_META, type DeckVariant } from '@/lib/deck-meta'
import { buildMarketingUrl } from '@/lib/domain'

type DeckSummary = {
  id: string
  name: string
  description: string | null
}

type MyDeckClientProps = {
  spaceName: string
  activeDecks: DeckSummary[]
  availableDecks: DeckSummary[]
  /** 과금 중(SubscriptionItem ACTIVE)인 deck — 이 업무는 구독 해지, 나머지는 사용 중지 */
  subscribedDeckIds: string[]
  isOwner: boolean
  cardSummary: string | null
  hasActiveSubscription: boolean
  /** 업무별 과금 정보 — 추가 전에 구독이 필요한지 판단한다 */
  billing: Array<{
    id: string
    pricingMode: 'FREE_BETA' | 'SUBSCRIPTION'
    monthlyPrice: number
    allowed: boolean
  }>
}

const DECK_ENTRY: Record<string, string> = {
  'coupang-ads': COUPANG_ADS_BASE_PATH,
  'seller-hub': SELLER_HUB_BASE_PATH,
  'sales-content': SALES_CONTENT_BASE_PATH,
}

function toDeckHref(deckId: string) {
  return DECK_ENTRY[deckId] ?? `/d/${deckId}`
}

/** deck id가 DECK_META에 등록된 variant일 때만 메타 반환 (workdeck 제외) */
function toDeckMeta(deckId: string) {
  if (deckId === 'workdeck') return null
  return deckId in DECK_META ? DECK_META[deckId as DeckVariant] : null
}

function DeckCardTitle({ deck }: { deck: DeckSummary }) {
  const meta = toDeckMeta(deck.id)
  return (
    <div className="flex items-center gap-2.5">
      {meta && (
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${meta.gradient}`}
        >
          <meta.icon className="h-4 w-4 text-white" />
        </div>
      )}
      <CardTitle className="text-base">{deck.name}</CardTitle>
    </div>
  )
}

function DeckIntroLink({ deck }: { deck: DeckSummary }) {
  if (!toDeckMeta(deck.id)) return null
  return (
    <a
      href={buildMarketingUrl(`/${deck.id}`)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${deck.name} 소개 페이지 새 탭에서 열기`}
      className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground underline underline-offset-2 hover:text-foreground"
    >
      자세히 확인
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function MyDeckClient({
  spaceName,
  activeDecks,
  availableDecks,
  subscribedDeckIds,
  isOwner,
  cardSummary,
  hasActiveSubscription,
  billing,
}: MyDeckClientProps) {
  const router = useRouter()
  const [selectedDeck, setSelectedDeck] = useState<DeckSummary | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<DeckSummary | null>(null)
  const [isCanceling, setIsCanceling] = useState(false)

  const subscribed = useMemo(() => new Set(subscribedDeckIds), [subscribedDeckIds])
  const billingById = useMemo(() => new Map(billing.map((b) => [b.id, b])), [billing])
  const [pending, setPending] = useState<SubscribeTarget | null>(null)
  const [subscribeBusy, setSubscribeBusy] = useState(false)
  const searchParams = useSearchParams()

  /** 유료인데 아직 쓸 권한이 없으면 구독이 선행되어야 한다 */
  const needsSubscription = useCallback(
    (deckId: string) => {
      const info = billingById.get(deckId)
      return Boolean(info && info.pricingMode === 'SUBSCRIPTION' && !info.allowed)
    },
    [billingById]
  )

  const openDeck = useCallback(
    (deck: DeckSummary) => {
      if (!needsSubscription(deck.id)) {
        setSelectedDeck(deck)
        return
      }
      if (!isOwner) {
        toast.error('구독이 필요한 업무입니다. 워크스페이스 소유자에게 요청하세요.')
        return
      }
      const info = billingById.get(deck.id)
      setPending({
        decks: [{ id: deck.id, name: deck.name, monthlyPrice: info?.monthlyPrice ?? 0 }],
        isAddition: hasActiveSubscription,
      })
    },
    [billingById, hasActiveSubscription, isOwner, needsSubscription]
  )

  const hasActiveDecks = useMemo(() => activeDecks.length > 0, [activeDecks.length])
  const hasAvailableDecks = useMemo(() => availableDecks.length > 0, [availableDecks.length])

  async function confirmAddDeck() {
    if (!selectedDeck || isSubmitting) return
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/spaces/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckAppId: selectedDeck.id }),
      })

      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as { message?: string } | null
        throw new Error(error?.message ?? '추가에 실패했습니다')
      }

      toast.success(`추가되었습니다: ${selectedDeck.name}`)
      setSelectedDeck(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '추가 중 오류가 발생했습니다')
    } finally {
      setIsSubmitting(false)
    }
  }

  /** 구독(신규 시작 또는 업무 추가) 후 곧바로 업무를 활성화한다. */
  const confirmSubscribe = useCallback(async () => {
    if (!pending || subscribeBusy) return
    const deck = pending.decks[0]
    setSubscribeBusy(true)
    try {
      const url = pending.isAddition
        ? '/api/billing/subscription/decks'
        : '/api/billing/subscription/start'
      const body = pending.isAddition ? { deckAppId: deck.id } : { deckIds: [deck.id] }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(json?.error ?? '구독에 실패했습니다')

      // 구독이 끝나야 entitlement 게이트를 통과하므로 여기서 deck 을 활성화한다.
      const addRes = await fetch('/api/spaces/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckAppId: deck.id }),
      })
      if (!addRes.ok && addRes.status !== 409) {
        const err = (await addRes.json().catch(() => null)) as { message?: string } | null
        throw new Error(err?.message ?? '업무 활성화에 실패했습니다')
      }

      toast.success(`${deck.name} 구독을 시작했습니다`)
      setPending(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '구독 중 오류가 발생했습니다')
    } finally {
      setSubscribeBusy(false)
    }
  }, [pending, router, subscribeBusy])

  // 마케팅 랜딩 딥링크(?subscribe=<slug>) 또는 카드 등록 왕복 후 해당 업무 모달을 연다.
  const subscribeParam = searchParams.get('subscribe')
  useEffect(() => {
    if (!subscribeParam) return
    window.history.replaceState(null, '', window.location.pathname)
    const deck = availableDecks.find((d) => d.id === subscribeParam)
    if (!deck) return
    openDeck(deck)
  }, [subscribeParam, availableDecks, openDeck])

  /**
   * 과금 중이면 구독 해지(기간 말까지 이용), 아니면 업무 사용 중지(목록에서 내림).
   * 무료 제공·유예·Trial 업무는 해지할 구독 아이템이 없어 billing API 가 404 를 낸다.
   */
  async function confirmCancelDeck() {
    if (!cancelTarget || isCanceling) return
    const isSubscribed = subscribed.has(cancelTarget.id)
    setIsCanceling(true)

    try {
      const response = await fetch(
        isSubscribed ? '/api/billing/subscription/decks' : '/api/spaces/decks',
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deckAppId: cancelTarget.id }),
        }
      )

      const payload = (await response.json().catch(() => null)) as {
        message?: string
        error?: string
        effectiveAt?: string | null
      } | null

      if (!response.ok) {
        throw new Error(
          payload?.message ??
            payload?.error ??
            (isSubscribed ? '구독 해지에 실패했습니다' : '사용 중지에 실패했습니다')
        )
      }

      if (isSubscribed) {
        toast.success(
          payload?.effectiveAt
            ? `${cancelTarget.name} 구독을 해지했습니다. ${formatDate(payload.effectiveAt)}까지 이용할 수 있습니다.`
            : `${cancelTarget.name} 구독을 해지했습니다.`
        )
      } else {
        toast.success(`${cancelTarget.name} 사용을 중지했습니다. 언제든 다시 추가할 수 있습니다.`)
      }
      setCancelTarget(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '처리 중 오류가 발생했습니다')
    } finally {
      setIsCanceling(false)
    }
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">내 워크덱</h1>
        <p className="text-sm text-muted-foreground">
          {spaceName} 계정에서 사용할 업무를 관리하세요.
        </p>
      </header>

      <section aria-labelledby="active-decks-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="active-decks-heading" className="text-xl font-semibold">
            사용 중인 업무
          </h2>
          <Badge variant="secondary">{activeDecks.length}개</Badge>
        </div>

        {!hasActiveDecks ? (
          <Card className="border-dashed">
            <CardContent className="py-8">
              <p className="text-sm text-muted-foreground">
                현재 사용 중인 업무가 없습니다. 아래에서 추가해주세요.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {activeDecks.map((deck) => (
              <Card key={deck.id} className="gap-4">
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <DeckCardTitle deck={deck} />
                    <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                      사용 중
                    </Badge>
                  </div>
                  <CardDescription className="min-h-10">
                    {toDeckMeta(deck.id)?.description ??
                      deck.description ??
                      '상세 설명이 아직 등록되지 않았습니다.'}{' '}
                    <DeckIntroLink deck={deck} />
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button asChild className="w-full">
                    <Link href={toDeckHref(deck.id)}>
                      빠르게 진입
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                  {isOwner && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-muted-foreground hover:text-foreground"
                      onClick={() => setCancelTarget(deck)}
                      aria-label={`${deck.name} ${subscribed.has(deck.id) ? '구독 해지' : '사용 중지'} 확인 열기`}
                    >
                      {subscribed.has(deck.id) ? '구독 해지' : '사용 중지'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="available-decks-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="available-decks-heading" className="text-xl font-semibold">
            추가할 수 있는 업무
          </h2>
          <Badge variant="outline">{availableDecks.length}개</Badge>
        </div>

        {!hasAvailableDecks ? (
          <Card className="border-dashed">
            <CardContent className="py-8">
              <p className="text-sm text-muted-foreground">추가할 수 있는 업무가 없습니다.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {availableDecks.map((deck) => (
              <Card key={deck.id} className="gap-4">
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <DeckCardTitle deck={deck} />
                    <Badge variant="outline">미사용</Badge>
                  </div>
                  <CardDescription className="min-h-10">
                    {toDeckMeta(deck.id)?.description ??
                      deck.description ??
                      '상세 설명이 아직 등록되지 않았습니다.'}{' '}
                    <DeckIntroLink deck={deck} />
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => openDeck(deck)}
                    aria-label={`${deck.name} 추가 확인 열기`}
                  >
                    <PlusCircle className="h-4 w-4" />
                    추가하기
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Dialog open={Boolean(selectedDeck)} onOpenChange={(open) => !open && setSelectedDeck(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>추가 확인</DialogTitle>
            <DialogDescription>
              {selectedDeck ? `추가할 업무: ${selectedDeck.name}` : '추가할 업무를 확인해주세요.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelectedDeck(null)} disabled={isSubmitting}>
              취소
            </Button>
            <Button onClick={confirmAddDeck} disabled={!selectedDeck || isSubmitting}>
              {isSubmitting ? '추가 중...' : '추가하기'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => !open && !isCanceling && setCancelTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {cancelTarget && subscribed.has(cancelTarget.id)
                ? '구독을 해지할까요?'
                : '사용을 중지할까요?'}
            </DialogTitle>
            <DialogDescription>
              {!cancelTarget
                ? '확인할 업무를 선택해주세요.'
                : subscribed.has(cancelTarget.id)
                  ? `${cancelTarget.name} 구독을 해지하면 이미 결제한 이용 기간의 마지막 날까지는 그대로 사용할 수 있고, 다음 주기부터 요금이 청구되지 않습니다. 기존 데이터는 삭제되지 않습니다.`
                  : `${cancelTarget.name}을(를) 사용 중인 업무에서 내립니다. 기존 데이터는 삭제되지 않으며 언제든 다시 추가할 수 있습니다.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelTarget(null)} disabled={isCanceling}>
              돌아가기
            </Button>
            <Button
              variant="destructive"
              onClick={confirmCancelDeck}
              disabled={!cancelTarget || isCanceling}
            >
              {isCanceling
                ? '처리 중...'
                : cancelTarget && subscribed.has(cancelTarget.id)
                  ? '구독 해지'
                  : '사용 중지'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SubscribeDialog
        target={pending}
        cardSummary={cardSummary}
        returnTo={`/my-deck?subscribe=${pending?.decks[0]?.id ?? ''}`}
        busy={subscribeBusy}
        onCancel={() => setPending(null)}
        onConfirm={confirmSubscribe}
      />
    </div>
  )
}
