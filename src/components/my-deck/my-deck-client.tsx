'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
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
import {
  COUPANG_ADS_BASE_PATH,
  SELLER_HUB_BASE_PATH,
  SALES_CONTENT_BASE_PATH,
} from '@/lib/deck-routes'

type DeckSummary = {
  id: string
  name: string
  description: string | null
}

type MyDeckClientProps = {
  spaceName: string
  activeDecks: DeckSummary[]
  availableDecks: DeckSummary[]
  /** 과금 중(SubscriptionItem ACTIVE)인 deck — 이 업무에만 구독 해제를 노출한다 */
  subscribedDeckIds: string[]
}

const DECK_ENTRY: Record<string, string> = {
  'coupang-ads': COUPANG_ADS_BASE_PATH,
  'seller-hub': SELLER_HUB_BASE_PATH,
  'sales-content': SALES_CONTENT_BASE_PATH,
}

function toDeckHref(deckId: string) {
  return DECK_ENTRY[deckId] ?? `/d/${deckId}`
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
}: MyDeckClientProps) {
  const router = useRouter()
  const [selectedDeck, setSelectedDeck] = useState<DeckSummary | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<DeckSummary | null>(null)
  const [isCanceling, setIsCanceling] = useState(false)

  const subscribed = useMemo(() => new Set(subscribedDeckIds), [subscribedDeckIds])

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

  async function confirmCancelDeck() {
    if (!cancelTarget || isCanceling) return
    setIsCanceling(true)

    try {
      const response = await fetch('/api/billing/subscription/decks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckAppId: cancelTarget.id }),
      })

      const payload = (await response.json().catch(() => null)) as {
        message?: string
        effectiveAt?: string | null
      } | null

      if (!response.ok) {
        throw new Error(payload?.message ?? '구독 해제에 실패했습니다')
      }

      toast.success(
        payload?.effectiveAt
          ? `${cancelTarget.name} 구독을 해제했습니다. ${formatDate(payload.effectiveAt)}까지 이용할 수 있습니다.`
          : `${cancelTarget.name} 구독을 해제했습니다.`
      )
      setCancelTarget(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '구독 해제 중 오류가 발생했습니다')
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
                    <CardTitle className="text-base">{deck.name}</CardTitle>
                    <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                      사용 중
                    </Badge>
                  </div>
                  <CardDescription className="min-h-10">
                    {deck.description ?? '상세 설명이 아직 등록되지 않았습니다.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button asChild className="w-full">
                    <Link href={toDeckHref(deck.id)}>
                      빠르게 진입
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                  {subscribed.has(deck.id) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-muted-foreground hover:text-foreground"
                      onClick={() => setCancelTarget(deck)}
                      aria-label={`${deck.name} 구독 해제 확인 열기`}
                    >
                      구독 해제
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
                    <CardTitle className="text-base">{deck.name}</CardTitle>
                    <Badge variant="outline">미사용</Badge>
                  </div>
                  <CardDescription className="min-h-10">
                    {deck.description ?? '상세 설명이 아직 등록되지 않았습니다.'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setSelectedDeck(deck)}
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
            <DialogTitle>구독을 해제할까요?</DialogTitle>
            <DialogDescription>
              {cancelTarget
                ? `${cancelTarget.name} 구독을 해제하면 이미 결제한 이용 기간의 마지막 날까지는 그대로 사용할 수 있고, 다음 주기부터 요금이 청구되지 않습니다. 기존 데이터는 삭제되지 않습니다.`
                : '해제할 업무를 확인해주세요.'}
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
              {isCanceling ? '해제 중...' : '구독 해제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
