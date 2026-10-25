'use client'

import { useEffect, useMemo, useState } from 'react'

import type { DiscoverWord, KeywordAdStat } from '@/lib/sh/ad-keyword-performance'
import { normalizeKeyword } from '@/lib/sh/keyword-normalize'

export type AdPerformanceData = {
  attributed: boolean
  window: { from: string; to: string } | null
  keywordStats: Record<string, KeywordAdStat>
  discover: DiscoverWord[]
  prune: string[]
}

/** 2100 → '2.1천', 12000 → '1.2만' */
export function formatCount(n: number): string {
  if (n >= 10000) return `${+(n / 10000).toFixed(1)}만`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}천`
  return String(n)
}

/**
 * 대상(`cp:<id>` | `ls:<id>`)의 광고 성과를 불러온다. 보조 정보라 실패는 조용히 무시한다.
 * adBadges 는 KeywordEditor 칩 뒤에 붙는 문구(normalizeKeyword 키).
 */
export function useKeywordAdPerformance(targetKey: string | null) {
  const [data, setData] = useState<AdPerformanceData | null>(null)

  useEffect(() => {
    if (!targetKey) return
    const [kind, id] = [targetKey.slice(0, 2), targetKey.slice(3)]
    const param = kind === 'cp' ? 'channelProductId' : 'listingId'
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/sh/keywords/ad-performance?${param}=${encodeURIComponent(id)}`,
          { cache: 'no-store' }
        )
        if (!res.ok || cancelled) return
        setData(await res.json())
      } catch {
        // 광고 성과 없이도 편집에는 지장이 없다.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [targetKey])

  const adBadges = useMemo(() => {
    const out: Record<string, string> = {}
    if (!targetKey || !data?.attributed) return out
    for (const [kw, s] of Object.entries(data.keywordStats)) {
      out[normalizeKeyword(kw)] =
        s.imp === 0 ? '30일 노출 0' : `노출 ${formatCount(s.imp)} · 주문 ${s.ord}`
    }
    return out
  }, [data, targetKey])

  return { data: targetKey ? data : null, adBadges }
}
