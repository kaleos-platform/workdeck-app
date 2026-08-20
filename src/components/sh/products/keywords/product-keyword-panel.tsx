'use client'

// 상품 축 키워드 화면의 우측 패널 — 선택된 상품이 나가는 모든 판매채널 카드를 세로로 나열한다.

import { useCallback, useEffect, useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'

import { ProductKeywordCard, type KeywordCard } from './product-keyword-card'

type Props = {
  productId: string | null
}

export function ProductKeywordPanel({ productId }: Props) {
  const [cards, setCards] = useState<KeywordCard[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!productId) {
      setCards([])
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/products/${productId}/keyword-cards`)
      if (!res.ok) throw new Error('카드 조회 실패')
      const data: { cards: KeywordCard[] } = await res.json()
      setCards(data.cards ?? [])
    } catch {
      setCards([])
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    load()
  }, [load])

  if (!productId) {
    return (
      <Card>
        <CardContent className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          상품을 선택하세요
        </CardContent>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          불러오는 중...
        </CardContent>
      </Card>
    )
  }

  if (cards.length === 0) {
    return (
      <Card>
        <CardContent className="flex h-64 flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm text-muted-foreground">
            이 상품만으로 구성된 판매채널 상품이 없습니다
          </p>
          <p className="text-xs text-muted-foreground">
            여러 상품이 함께 묶인 세트 상품은 여기서 편집할 수 없습니다
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {cards.map((card) => (
        <ProductKeywordCard key={card.id} card={card} onSaved={load} />
      ))}
    </div>
  )
}
