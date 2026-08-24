'use client'

// 상품 축 키워드 화면의 우측 패널 — 선택된 상품이 나가는 모든 판매채널 카드를 세로로 나열한다.

import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

import { ProductKeywordCard, type KeywordCard } from './product-keyword-card'

type Props = {
  productId: string | null
}

export function ProductKeywordPanel({ productId }: Props) {
  const [cards, setCards] = useState<KeywordCard[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  // onSaved 재조회는 카운터를 올려 같은 effect 를 다시 태운다 — productId 전환의
  // cancelled 가드를 재조회 요청에도 동일하게 적용하기 위해서(별도 fetch 경로를 두지 않는다).
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!productId) {
      setCards([])
      setSuggestions([])
      setError(false)
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(false)
      try {
        const res = await fetch(`/api/sh/products/${productId}/keyword-cards`)
        if (!res.ok) throw new Error('카드 조회 실패')
        const data: { cards: KeywordCard[] } = await res.json()
        if (cancelled) return
        setCards(data.cards ?? [])
        setError(false)
      } catch {
        if (cancelled) return
        setCards([])
        setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }

      // 추천은 부가 기능이라 카드 조회와 별개의 try — 실패해도 error 상태(카드 조회 전용)를
      // 건드리지 않고 조용히 빈 배열로 둔다.
      try {
        const res = await fetch(`/api/sh/keywords/suggest?productId=${productId}`)
        if (!res.ok) throw new Error('추천 조회 실패')
        const data: { suggestions: string[] } = await res.json()
        if (cancelled) return
        setSuggestions(data.suggestions ?? [])
      } catch {
        if (cancelled) return
        setSuggestions([])
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [productId, refreshKey])

  const reload = useCallback(() => setRefreshKey((n) => n + 1), [])

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

  if (error) {
    return (
      <Card>
        <CardContent className="flex h-64 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-muted-foreground">판매채널 상품을 불러오지 못했습니다</p>
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            다시 시도
          </Button>
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
        <ProductKeywordCard
          key={card.id}
          card={card}
          productId={productId}
          suggestions={suggestions}
          onSaved={reload}
        />
      ))}
    </div>
  )
}
