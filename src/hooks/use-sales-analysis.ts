'use client'

import { useEffect, useState } from 'react'
import {
  bucketRevenue,
  type DateRange,
  type DateRevenueRow,
  type RevenueBucket,
  type SalesUnit,
} from '@/lib/sh/sales-analytics'

export type SalesAnalysisData = {
  /** 단위 버킷 시계열 (차트·테이블 매트릭스 공유). 채널별 revenue+orderCount 포함(로켓 포함). */
  buckets: RevenueBucket[]
  loading: boolean
}

const EMPTY: SalesAnalysisData = { buckets: [], loading: false }

/**
 * 판매분석 데이터 로더 — `groupBy=date` 1회만.
 * buckets 에 채널별 revenue+orderCount 가 모두 담겨 있으므로(로켓 포함),
 * 합계·증감은 표시 채널 집합으로 클라이언트에서 계산한다(선택 연동 정합).
 * 로켓 units 제외는 `bucketTotalsFor(unitCountIds)` 로 처리.
 */
export function useSalesAnalysis(
  unit: SalesUnit,
  range: DateRange,
  channelIds: string[]
): SalesAnalysisData {
  const [data, setData] = useState<SalesAnalysisData>(EMPTY)
  const channelIdsKey = channelIds.join(',')

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (channelIdsKey === '') {
        if (!cancelled) setData({ ...EMPTY })
        return
      }
      if (!cancelled) setData((d) => ({ ...d, loading: true }))

      const url = `/api/sh/dashboard/revenue?from=${range.from}&to=${range.to}&groupBy=date&channelIds=${channelIdsKey}`

      try {
        const res = await fetch(url).then((r) => (r.ok ? r.json() : null))
        if (cancelled) return

        const dateRows: DateRevenueRow[] = (res?.rows ?? []).map((r: DateRevenueRow) => ({
          date: r.date,
          channelId: r.channelId,
          totalRevenue: Number(r.totalRevenue ?? 0),
          orderCount: Number(r.orderCount ?? 0),
        }))

        setData({ buckets: bucketRevenue(dateRows, unit), loading: false })
      } catch {
        if (!cancelled) setData((d) => ({ ...d, loading: false }))
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [unit, range.from, range.to, channelIdsKey])

  return data
}
