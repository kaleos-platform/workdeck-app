import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { isYmdDateString } from '@/lib/date-range'
import { prisma } from '@/lib/prisma'
import { loadProductSales } from '@/lib/sh/product-sales'
import { queryProductMargin } from '@/lib/sh/margin-query'
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

  // 체크박스 기본값 — 카테고리 관리의 「판매분석 제외」. margin-query 기본값과 같은 컬럼이다.
  const defaultExcludedGroupIds = (
    await prisma.invProductGroup.findMany({
      where: { spaceId: resolved.space.id, excludeFromSalesAnalytics: true },
      select: { id: true },
    })
  ).map((g) => g.id)

  if (channels.length === 0) {
    return NextResponse.json({
      period,
      prevPeriod: prev,
      defaultExcludedGroupIds,
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

  // 옵션별 비용·공헌이익 — 방금 불러온 매출을 그대로 넘겨 재집계 없이 비용만 붙인다.
  // 카테고리 제외는 화면 체크박스가 결정하므로 여기선 전 카테고리를 계산해 둔다(비용 분모는
  // 어차피 조회 범위와 무관하게 전체 기준이라 카테고리 필터와 독립적이다).
  const margin = await queryProductMargin(
    resolved.space.id,
    { from: fromParam, to: toParam, excludeProductGroupNames: [] },
    { sales: current, unpaginated: true }
  )
  const margins = margin.rows.map((r) => ({
    optionId: r.optionId,
    // 판매 없이 광고비만 나간 옵션은 rows 에 없어 이름 출처가 여기뿐이다.
    productId: r.productId,
    productName: r.productInternalName?.trim() || r.productName,
    optionName: r.optionName,
    productGroupId: r.productGroupId,
    cogs: r.cogs,
    commissionFee: r.commissionFee,
    shippingCost: r.shippingCost,
    packagingCost: r.packagingCost,
    adCost: r.adCost,
    contributionProfit: r.contributionProfit,
    unitCost: r.unitCost,
  }))

  return NextResponse.json({
    period,
    prevPeriod: prev,
    defaultExcludedGroupIds,
    rows: current.rows,
    margins,
    marginMissingFields: margin.missingFields,
    prevTotals: Array.from(prevMap.values()),
    unmatched: { ...current.unmatched, prevRevenue: previous.unmatched.revenue },
    coverage: current.coverage,
  })
}
