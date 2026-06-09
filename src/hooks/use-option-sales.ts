'use client'

import { useEffect, useState } from 'react'
import {
  bucketOptionQty,
  type DateRange,
  type OptionBucket,
  type OptionQtyRow,
  type SalesUnit,
} from '@/lib/sh/sales-analytics'

export type OptionSalesData = {
  /** 단위 버킷 시계열 — 옵션별 판매량(수량). */
  buckets: OptionBucket[]
  /** optionId → "상품명 / 옵션명" (표시 옵션 라벨용). */
  nameById: Map<string, string>
  loading: boolean
}

const EMPTY: OptionSalesData = { buckets: [], nameById: new Map(), loading: false }

/**
 * 판매분석 "상품(옵션)" 탭 데이터 로더 — `groupBy=date` 1회.
 * use-sales-analysis 미러. rows 의 optionName 으로 nameById 를 함께 구성한다.
 */
export function useOptionSales(
  unit: SalesUnit,
  range: DateRange,
  channelIds: string[],
  enabled: boolean
): OptionSalesData {
  const [data, setData] = useState<OptionSalesData>(EMPTY)
  const channelIdsKey = channelIds.join(',')

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const run = async () => {
      if (channelIdsKey === '') {
        if (!cancelled) setData({ ...EMPTY, nameById: new Map() })
        return
      }
      if (!cancelled) setData((d) => ({ ...d, loading: true }))

      const url = `/api/sh/dashboard/sales-by-option?from=${range.from}&to=${range.to}&groupBy=date&channelIds=${channelIdsKey}`

      try {
        const res = await fetch(url).then((r) => (r.ok ? r.json() : null))
        if (cancelled) return

        const rows: OptionQtyRow[] = (res?.rows ?? []).map((r: OptionQtyRow) => ({
          date: r.date,
          optionId: r.optionId,
          optionName: r.optionName,
          channelId: r.channelId,
          quantity: Number(r.quantity ?? 0),
        }))

        const nameById = new Map<string, string>()
        for (const r of rows) {
          if (!nameById.has(r.optionId)) nameById.set(r.optionId, r.optionName)
        }

        setData({ buckets: bucketOptionQty(rows, unit), nameById, loading: false })
      } catch {
        if (!cancelled) setData((d) => ({ ...d, loading: false }))
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [enabled, unit, range.from, range.to, channelIdsKey])

  return data
}
