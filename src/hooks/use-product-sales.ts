'use client'

import { useEffect, useState } from 'react'
import {
  bucketOptionQty,
  buildOptionCatalog,
  buildProductRanking,
  type DateRange,
  type OptionBucket,
  type OptionCatalogProduct,
  type OptionQtyRow,
  type PrevOptionTotal,
  type ProductRanking,
  type SalesUnit,
  type UnmatchedTotals,
} from '@/lib/sh/sales-analytics'

/** 상품 귀속 커버리지 — 배지·툴팁 소스. 현재 필터 기준으로 서버가 계산한다. */
export type SalesCoverage = {
  totalRevenue: number
  attributedRevenue: number
  ratio: number | null
  direct: {
    revenueTotal: number
    revenueAttributed: number
    lines: number
    linesAttributed: number
  }
  rocket: { revenueTotal: number; revenueAttributed: number; unmappedRevenue: number }
}

export type ProductSalesData = {
  /** 단위 버킷 시계열 — 옵션별 수량·매출. */
  buckets: OptionBucket[]
  /** 기간 내 판매 있는 상품→옵션 계층 (시리즈 해석용). */
  catalog: OptionCatalogProduct[]
  /** 상품 랭킹 (미매칭 행·비중 포함). */
  ranking: ProductRanking | null
  coverage: SalesCoverage | null
  /** 증감 비교 구간 — 헤더에 그대로 표기한다. */
  prevPeriod: DateRange | null
  loading: boolean
}

const EMPTY: ProductSalesData = {
  buckets: [],
  catalog: [],
  ranking: null,
  coverage: null,
  prevPeriod: null,
  loading: false,
}

/**
 * 판매분석 "상품" 탭 데이터 로더 — /api/sh/dashboard/sales-by-product 1회.
 * rows → 시계열 버킷 + 카탈로그 + 랭킹 모두 여기서 파생한다(숫자 소스 단일화).
 */
export function useProductSales(
  unit: SalesUnit,
  range: DateRange,
  channelIds: string[],
  enabled: boolean
): ProductSalesData {
  const [data, setData] = useState<ProductSalesData>(EMPTY)
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

      const url = `/api/sh/dashboard/sales-by-product?from=${range.from}&to=${range.to}&channelIds=${channelIdsKey}`

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
          revenue: Number(r.revenue ?? 0),
        }))
        const prevTotals: PrevOptionTotal[] = (res?.prevTotals ?? []).map((p: PrevOptionTotal) => ({
          optionId: p.optionId,
          productId: p.productId,
          quantity: Number(p.quantity ?? 0),
          revenue: Number(p.revenue ?? 0),
        }))
        const unmatched: UnmatchedTotals = {
          revenue: Number(res?.unmatched?.revenue ?? 0),
          quantity: Number(res?.unmatched?.quantity ?? 0),
          prevRevenue: Number(res?.unmatched?.prevRevenue ?? 0),
          byReason: res?.unmatched?.byReason,
        }

        setData({
          buckets: bucketOptionQty(rows, unit),
          catalog: buildOptionCatalog(rows),
          ranking: buildProductRanking(rows, prevTotals, unmatched),
          coverage: res?.coverage ?? null,
          prevPeriod: res?.prevPeriod ?? null,
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
