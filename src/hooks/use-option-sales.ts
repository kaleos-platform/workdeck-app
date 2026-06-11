'use client'

import { useEffect, useState } from 'react'
import {
  bucketOptionQty,
  buildOptionCatalog,
  type DateRange,
  type OptionBucket,
  type OptionCatalogProduct,
  type OptionQtyRow,
  type SalesUnit,
} from '@/lib/sh/sales-analytics'

export type OptionSalesData = {
  /** 단위 버킷 시계열 — 옵션별 판매량(수량). */
  buckets: OptionBucket[]
  /** 기간 내 판매 있는 상품→옵션 계층 카탈로그 (필터 목록용). */
  catalog: OptionCatalogProduct[]
  loading: boolean
}

const EMPTY: OptionSalesData = { buckets: [], catalog: [], loading: false }

/**
 * 판매분석 "상품(옵션)" 탭 데이터 로더 — `groupBy=date` 1회.
 * rows → bucketOptionQty(시계열) + buildOptionCatalog(필터 목록) 둘 다 산출.
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
        if (!cancelled) setData({ ...EMPTY })
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
          productId: r.productId,
          productName: r.productName,
          channelId: r.channelId,
          quantity: Number(r.quantity ?? 0),
        }))

        setData({
          buckets: bucketOptionQty(rows, unit),
          catalog: buildOptionCatalog(rows),
          loading: false,
        })
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
