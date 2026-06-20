'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, AlertTriangle } from 'lucide-react'
import { CardFooter } from '@/components/ui/card'

// 홈 대시보드 카드 공통 조각 — 데이터 fetch 훅 + 로딩/에러 상태 + 푸터 링크.
// 모든 요약 카드가 동일한 grammar(stock-alerts-card 기반)를 공유하도록 추출.

/**
 * 홈 카드 데이터 fetch 훅 — GET url → { data, loading, error }.
 * 모든 요약 카드의 useState×3 + useEffect+fetch 보일러플레이트를 한 곳으로 수렴.
 */
export function useCardData<T>(url: string): { data: T | null; loading: boolean; error: boolean } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((json: T) => {
        if (active) setData(json)
      })
      .catch(() => {
        if (active) setError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [url])

  return { data, loading, error }
}

/** 데이터 로딩 실패 인라인 표시. */
export function CardError({ message = '데이터를 불러오지 못했습니다.' }: { message?: string }) {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

/** 빈 상태 (조치 불필요 = 긍정 신호). */
export function CardEmpty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>
}

/** 목록형 로딩 스켈레톤 (n행). */
export function CardListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="로딩 중">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-2">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

/** 푸터 이동 링크 ("배송 → 배송 데이터" 형태). */
export function CardFooterLink({ href, label }: { href: string; label: string }) {
  return (
    <CardFooter className="pt-2">
      <Link
        href={href}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        aria-label={`${label} 페이지로 이동`}
      >
        {label}
        <ArrowRight className="h-3 w-3" />
      </Link>
    </CardFooter>
  )
}
