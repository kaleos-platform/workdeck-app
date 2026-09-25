import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { isYmdDateString } from '@/lib/date-range'
import { prisma } from '@/lib/prisma'
import { loadProductSales } from '@/lib/sh/product-sales'
import { prevRange } from '@/lib/sh/sales-analytics'

// 판매분석 "상품" 탭 — 일자×내부옵션×채널 수량·매출 + 미매칭 + 커버리지 + 비교 구간.
// 집계 본체는 loadProductSales. 랭킹/정렬/롤업은 클라이언트가 한다
// (서버가 랭킹을 따로 내면 같은 숫자가 두 경로로 생겨 어긋난다).
//
// ⚠️ 기간 경계·paymentAmount·채널 필터는 채널 탭(/api/sh/dashboard/revenue)과 동일 정의다.
//    바꾸면 커버리지 배지가 거짓말을 한다.

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const channelIdsParam = searchParams.get('channelIds')

  if (!fromParam || !toParam) {
    return errorResponse('from, to 쿼리 파라미터가 필요합니다', 400)
  }
  if (!isYmdDateString(fromParam) || !isYmdDateString(toParam)) {
    return errorResponse('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)', 400)
  }

  // KST 경계 (revenue route 와 동일 규약)
  const from = new Date(fromParam + 'T00:00:00+09:00')
  const to = new Date(toParam + 'T23:59:59+09:00')
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return errorResponse('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)', 400)
  }
  if (from > to) {
    return errorResponse('from이 to보다 이후일 수 없습니다', 400)
  }

  const prev = prevRange({ from: fromParam, to: toParam })
  const prevFrom = new Date(prev.from + 'T00:00:00+09:00')
  const prevTo = new Date(prev.to + 'T23:59:59+09:00')

  const channelIds = channelIdsParam
    ? channelIdsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined

  const channels = await prisma.channel.findMany({
    where: {
      spaceId: resolved.space.id,
      ...(channelIds && channelIds.length > 0 ? { id: { in: channelIds } } : {}),
      isActive: true,
    },
    select: { id: true, name: true, externalSource: true },
    orderBy: { name: 'asc' },
  })

  const period = { from: fromParam, to: toParam }

  if (channels.length === 0) {
    return NextResponse.json({
      period,
      prevPeriod: prev,
      rows: [],
      prevTotals: [],
      unmatched: {
        revenue: 0,
        quantity: 0,
        byReason: {
          directUnmatched: 0,
          directExcluded: 0,
          rocketUnmapped: 0,
          rocketExcluded: 0,
        },
      },
      coverage: null,
    })
  }

  const [current, previous] = await Promise.all([
    loadProductSales(resolved.space.id, from, to, channels),
    loadProductSales(resolved.space.id, prevFrom, prevTo, channels),
  ])

  // 이전 구간은 날짜 grain 불필요 — 옵션 단위 합계만 내려보낸다.
  // 이름도 함께 내려보낸다 — 이번 구간에 판매가 없는 상품은 이것 말고는 이름 출처가 없다.
  const prevMap = new Map<
    string,
    {
      optionId: string
      productId: string
      productGroupId: string | null
      productName: string
      optionName: string
      quantity: number
      revenue: number
    }
  >()
  for (const r of previous.rows) {
    const entry = prevMap.get(r.optionId) ?? {
      optionId: r.optionId,
      productId: r.productId,
      productGroupId: r.productGroupId,
      productName: r.productName,
      optionName: r.optionName,
      quantity: 0,
      revenue: 0,
    }
    entry.quantity += r.quantity
    entry.revenue += r.revenue
    prevMap.set(r.optionId, entry)
  }

  return NextResponse.json({
    period,
    prevPeriod: prev,
    rows: current.rows,
    prevTotals: Array.from(prevMap.values()),
    unmatched: { ...current.unmatched, prevRevenue: previous.unmatched.revenue },
    coverage: current.coverage,
  })
}
