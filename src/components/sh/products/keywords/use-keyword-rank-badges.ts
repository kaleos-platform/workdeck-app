'use client'

import { useEffect, useState } from 'react'

import { normalizeKeyword } from '@/lib/sh/keyword-normalize'
import {
  formatRank,
  RANK_TRACKING_ENABLED,
  sourceShortLabel,
  type RankSource,
  type RankStatus,
} from './rank-format'

type LatestRank = { keyword: string; source: RankSource; status: RankStatus; rank: number | null }

/**
 * 추적 중인 대상의 최신 순위를 키워드 칩 배지 문구로 만든다.
 * targetKey 가 null(추적 꺼짐)이면 조회하지 않는다. 배지는 보조 정보라 실패는 조용히 무시한다.
 */
export function useKeywordRankBadges(targetKey: string | null): Record<string, string> {
  const [badges, setBadges] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!targetKey || !RANK_TRACKING_ENABLED) {
      setBadges({})
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/sh/keyword-ranks/latest?targetKey=${encodeURIComponent(targetKey)}`,
          { cache: 'no-store' }
        )
        if (!res.ok) return
        const data: { ranks: LatestRank[] } = await res.json()
        const grouped: Record<string, string[]> = {}
        for (const r of data.ranks ?? []) {
          const key = normalizeKeyword(r.keyword)
          ;(grouped[key] ??= []).push(`${sourceShortLabel(r.source)} ${formatRank(r)}`)
        }
        if (cancelled) return
        setBadges(Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, v.join(' · ')])))
      } catch {
        // 배지 없이도 편집에는 지장이 없다.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [targetKey])

  return badges
}
