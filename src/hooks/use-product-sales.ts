'use client'

import { useEffect, useMemo, useState } from 'react'
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

/** 랭킹·차트에 쓸 상품 그룹 목록 (기간 내 판매가 있는 것만). */
export type ProductGroupOption = { id: string; name: string }

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
  /** 기간 내 판매가 있는 상품 그룹 (필터 체크박스 목록). */
  groups: ProductGroupOption[]
  /** 실제로 제외 중인 그룹 id — 사용자가 손대기 전에는 기본 제외가 반영된 값. */
  excludedGroupIds: string[]
  /** 제외된 그룹의 매출 합 — 채널 탭 총매출과의 차이를 화면이 설명할 수 있게. */
  excludedRevenue: number
  excludedLabel: string | null
  loading: boolean
}

type RawState = {
  rows: OptionQtyRow[]
  prevTotals: PrevOptionTotal[]
  unmatched: UnmatchedTotals
  coverage: SalesCoverage | null
  prevPeriod: DateRange | null
  loading: boolean
}

const EMPTY_RAW: RawState = {
  rows: [],
  prevTotals: [],
  unmatched: { revenue: 0, quantity: 0 },
  coverage: null,
  prevPeriod: null,
  loading: false,
}

/**
 * 판매분석 "상품" 탭 데이터 로더 — /api/sh/dashboard/sales-by-product 1회.
 * rows → 시계열 버킷 + 카탈로그 + 랭킹 모두 여기서 파생한다(숫자 소스 단일화).
 */
/**
 * @param excludedGroupIds 집계에서 뺄 상품 그룹. **null 이면 아직 사용자가 손대지 않은
 *   상태**라 defaultExcludedGroupNames 로 기본 제외를 적용한다. 서버 재호출 없이
 *   이미 받은 rows 를 다시 파생하므로 체크박스 조작이 즉시 반영된다.
 * @param defaultExcludedGroupNames 부자재·체험단처럼 판매 실적으로 보지 않을 그룹 이름.
 */
export function useProductSales(
  unit: SalesUnit,
  range: DateRange,
  channelIds: string[],
  enabled: boolean,
  excludedGroupIds: string[] | null = null,
  defaultExcludedGroupNames: string[] = []
): ProductSalesData {
  const [raw, setRaw] = useState<RawState>(EMPTY_RAW)
  const channelIdsKey = channelIds.join(',')
  const excludedKey = excludedGroupIds === null ? null : excludedGroupIds.join(',')
  const defaultNamesKey = defaultExcludedGroupNames.join(',')

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const run = async () => {
      if (channelIdsKey === '') {
        if (!cancelled) setRaw({ ...EMPTY_RAW })
        return
      }
      if (!cancelled) setRaw((d) => ({ ...d, loading: true }))

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
          productGroupId: r.productGroupId ?? null,
          productGroupName: r.productGroupName ?? null,
          channelId: r.channelId,
          quantity: Number(r.quantity ?? 0),
          revenue: Number(r.revenue ?? 0),
        }))
        const prevTotals: PrevOptionTotal[] = (res?.prevTotals ?? []).map((p: PrevOptionTotal) => ({
          optionId: p.optionId,
          productId: p.productId,
          productGroupId: p.productGroupId ?? null,
          productName: p.productName,
          optionName: p.optionName,
          quantity: Number(p.quantity ?? 0),
          revenue: Number(p.revenue ?? 0),
        }))
        const unmatched: UnmatchedTotals = {
          revenue: Number(res?.unmatched?.revenue ?? 0),
          quantity: Number(res?.unmatched?.quantity ?? 0),
          prevRevenue: Number(res?.unmatched?.prevRevenue ?? 0),
          byReason: res?.unmatched?.byReason,
        }

        setRaw({
          rows,
          prevTotals,
          unmatched,
          coverage: res?.coverage ?? null,
          prevPeriod: res?.prevPeriod ?? null,
          loading: false,
        })
      } catch {
        if (!cancelled) setRaw((d) => ({ ...d, loading: false }))
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [enabled, range.from, range.to, channelIdsKey])

  // 그룹 목록은 필터 전 전체 rows 에서 만든다 — 제외된 그룹도 체크박스엔 보여야 한다.
  const groups = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of raw.rows) {
      if (r.productGroupId && r.productGroupName) m.set(r.productGroupId, r.productGroupName)
    }
    return [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [raw.rows])

  return useMemo(() => {
    const effectiveExcluded =
      excludedKey === null
        ? groups.filter((g) => defaultNamesKey.split(',').includes(g.name)).map((g) => g.id)
        : excludedKey
          ? excludedKey.split(',')
          : []
    const excluded = new Set(effectiveExcluded)
    // prevTotals 도 같이 걸러야 한다. 안 그러면 제외한 상품이 직전 기간 값만 갖고
    // 0원 행으로 되살아나고, 합계 증감이 현재(제외) vs 직전(포함)으로 어긋난다.
    const keep = <T extends { productGroupId?: string | null }>(r: T) =>
      !(r.productGroupId && excluded.has(r.productGroupId))
    const rows = excluded.size ? raw.rows.filter(keep) : raw.rows
    const excludedRevenue = excluded.size
      ? raw.rows.filter((r) => !keep(r)).reduce((a, r) => a + r.revenue, 0)
      : 0
    const excludedLabel =
      excluded.size > 0
        ? groups
            .filter((g) => excluded.has(g.id))
            .map((g) => g.name)
            .join('·')
        : null
    const prevTotals = excluded.size ? raw.prevTotals.filter(keep) : raw.prevTotals
    return {
      buckets: bucketOptionQty(rows, unit),
      catalog: buildOptionCatalog(rows),
      ranking: buildProductRanking(rows, prevTotals, raw.unmatched),
      coverage: raw.coverage,
      prevPeriod: raw.prevPeriod,
      groups,
      excludedGroupIds: effectiveExcluded,
      excludedRevenue,
      excludedLabel,
      loading: raw.loading,
    }
  }, [raw, unit, excludedKey, groups, defaultNamesKey])
}
