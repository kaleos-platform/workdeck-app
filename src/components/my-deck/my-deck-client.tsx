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
import { COUPANG_ADS_BASE_PATH } from '@/lib/deck-routes'

type DeckSummary = {
  id: string
  name: string
  description: string | null
}

type MyDeckClientProps = {
  spaceName: string
  activeDecks: DeckSummary[]
  availableDecks: DeckSummary[]
}

const DECK_ENTRY: Record<string, string> = {
  'coupang-ads': COUPANG_ADS_BASE_PATH,
}

function toDeckHref(deckId: string) {
  return DECK_ENTRY[deckId] ?? `/d/${deckId}`
}

export function MyDeckClient({ spaceName, activeDecks, availableDecks }: MyDeckClientProps) {
  const router = useRouter()
  const [selectedDeck, setSelectedDeck] = useState<DeckSummary | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

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
        throw new Error(error?.message ?? 'Deck 추가에 실패했습니다')
      }

      toast.success(`${selectedDeck.name} Deck이 추가되었습니다`)
      setSelectedDeck(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Deck 추가 중 오류가 발생했습니다')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">My Deck</h1>
        <p className="text-sm text-muted-foreground">{spaceName} 계정의 Deck을 관리하세요.</p>
      </header>

      <section aria-labelledby="active-decks-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="active-decks-heading" className="text-xl font-semibold">
            사용 중인 Deck
          </h2>
          <Badge variant="secondary">{activeDecks.length}개</Badge>
        </div>

        {!hasActiveDecks ? (
          <Card className="border-dashed">
            <CardContent className="py-8">
              <p className="text-sm text-muted-foreground">
                현재 사용 중인 Deck이 없습니다. 아래의 사용 가능한 Deck에서 추가해주세요.
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
                    {deck.description ?? '이 Deck의 상세 설명이 아직 등록되지 않았습니다.'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild className="w-full">
                    <Link href={toDeckHref(deck.id)}>
                      빠르게 진입
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="available-decks-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="available-decks-heading" className="text-xl font-semibold">
            사용 가능한 Deck
          </h2>
          <Badge variant="outline">{availableDecks.length}개</Badge>
        </div>

        {!hasAvailableDecks ? (
          <Card className="border-dashed">
            <CardContent className="py-8">
              <p className="text-sm text-muted-foreground">추가 가능한 Deck이 없습니다.</p>
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
                    {deck.description ?? '이 Deck의 상세 설명이 아직 등록되지 않았습니다.'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setSelectedDeck(deck)}
                    aria-label={`${deck.name} Deck 추가 확인 열기`}
                  >
                    <PlusCircle className="h-4 w-4" />
                    Deck 추가
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
            <DialogTitle>Deck 추가 확인</DialogTitle>
            <DialogDescription>
              {selectedDeck
                ? `${selectedDeck.name} Deck을 현재 계정에 추가하시겠습니까?`
                : '추가할 Deck을 확인해주세요.'}
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
    </div>
  )
}
