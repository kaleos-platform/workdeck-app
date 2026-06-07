'use client'

import { useEffect, useState } from 'react'
import {
  bucketRevenue,
  prevRangeForUnit,
  type DateRange,
  type DateRevenueRow,
  type RevenueBucket,
  type SalesUnit,
} from '@/lib/sh/sales-analytics'

type ChannelTotal = {
  channelId: string
  channelName: string
  totalRevenue: number
  orderCount: number
  isUnitCount: boolean
}

type ChannelApiRow = {
  channelId: string
  channelName: string
  totalRevenue: number
  orderCount: number
  isUnitCount?: boolean
}

export type SalesAnalysisData = {
  /** 단위 버킷 시계열 (차트·테이블 매트릭스 공유) */
  buckets: RevenueBucket[]
  /** 현재 구간 채널별 합계 (totals 정합 — 로켓 units 제외 규칙은 서버가 처리) */
  channelTotals: ChannelTotal[]
  /** 현재 구간 합계 */
  currentTotals: { totalRevenue: number; orderCount: number }
  /** 이전 구간 합계 (증감 비교용) */
  prevTotals: { totalRevenue: number; orderCount: number }
  loading: boolean
}

const EMPTY: SalesAnalysisData = {
  buckets: [],
  channelTotals: [],
  currentTotals: { totalRevenue: 0, orderCount: 0 },
  prevTotals: { totalRevenue: 0, orderCount: 0 },
  loading: false,
}

function sumTotals(rows: ChannelApiRow[]): { totalRevenue: number; orderCount: number } {
  // 서버 totals 규칙과 일치: 로켓(isUnitCount)의 orderCount 는 "수량"이라 주문 합계에서 제외.
  let totalRevenue = 0
  let orderCount = 0
  for (const r of rows) {
    totalRevenue += Number(r.totalRevenue ?? 0)
    if (!r.isUnitCount) orderCount += Number(r.orderCount ?? 0)
  }
  return { totalRevenue, orderCount }
}

/**
 * 판매분석 데이터 로더. 3회 호출:
 * 1) groupBy=date — 차트/테이블 매트릭스 시계열
 * 2) groupBy=channel (현재 구간) — 채널별 합계 + totals
 * 3) groupBy=channel (이전 구간) — 증감 비교 totals
 *
 * 정합성(로켓 units 제외)은 서버 channel 집계에 위임. date 는 표시용.
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

      const from = range.from
      const to = range.to
      const prev = prevRangeForUnit(unit, { from, to })
      const base = '/api/sh/dashboard/revenue'
      const dateUrl = `${base}?from=${from}&to=${to}&groupBy=date&channelIds=${channelIdsKey}`
      const curUrl = `${base}?from=${from}&to=${to}&groupBy=channel&channelIds=${channelIdsKey}`
      const prevUrl = `${base}?from=${prev.from}&to=${prev.to}&groupBy=channel&channelIds=${channelIdsKey}`

      try {
        const [dateRes, curRes, prevRes] = await Promise.all([
          fetch(dateUrl).then((r) => (r.ok ? r.json() : null)),
          fetch(curUrl).then((r) => (r.ok ? r.json() : null)),
          fetch(prevUrl).then((r) => (r.ok ? r.json() : null)),
        ])
        if (cancelled) return

        const dateRows: DateRevenueRow[] = (dateRes?.rows ?? []).map((r: DateRevenueRow) => ({
          date: r.date,
          channelId: r.channelId,
          totalRevenue: Number(r.totalRevenue ?? 0),
          orderCount: Number(r.orderCount ?? 0),
        }))
        const curRows: ChannelApiRow[] = curRes?.rows ?? []
        const prevRows: ChannelApiRow[] = prevRes?.rows ?? []

        setData({
          buckets: bucketRevenue(dateRows, unit),
          channelTotals: curRows.map((r) => ({
            channelId: r.channelId,
            channelName: r.channelName,
            totalRevenue: Number(r.totalRevenue ?? 0),
            orderCount: Number(r.orderCount ?? 0),
            isUnitCount: r.isUnitCount === true,
          })),
          currentTotals: curRes?.totals
            ? {
                totalRevenue: Number(curRes.totals.totalRevenue ?? 0),
                orderCount: Number(curRes.totals.orderCount ?? 0),
              }
            : sumTotals(curRows),
          prevTotals: prevRes?.totals
            ? {
                totalRevenue: Number(prevRes.totals.totalRevenue ?? 0),
                orderCount: Number(prevRes.totals.orderCount ?? 0),
              }
            : sumTotals(prevRows),
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
  }, [unit, range.from, range.to, channelIdsKey])

  return data
}
