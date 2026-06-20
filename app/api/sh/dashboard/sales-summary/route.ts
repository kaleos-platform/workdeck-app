import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { loadRocketDailyRevenue, sumRocketDaily } from '@/lib/sh/rocket-revenue'
import { getTodayStrKst } from '@/lib/date-range'
import {
  startOfMonth,
  prevRangeForUnit,
  pctChange,
  last30DaysRange,
} from '@/lib/sh/sales-analytics'

// 홈 대시보드 "판매 요약" 카드 — 이번달(MTD) vs 지난달 동기간 매출·주문 + 최근 30일.
//
// 동기간 정의: 이번달 1일~오늘 vs 지난달 1일~같은 날(말일 clamp). prevRangeForUnit('월') 사용.
// 최근 30일(recent30d): 상품 현황 카드(last30DaysRange)와 같은 윈도우 — 월초에 MTD가 0이어도
//   "주문 있는데 매출 0"처럼 보이는 정합성 혼동을 줄이기 위한 보조 지표.
// 매출은 전체 합계만 (DelOrderItem 에 라인별 금액이 없어 브랜드 분해 불가).
// 브랜드별은 주문수·판매량만 — 옵션→상품→Brand 롤업. 로켓그로스는 주문 단위가
// 아니므로 브랜드별 주문건수에서 제외(수동채널 DelOrder 만). 전체 합계에는 로켓 포함.

type BrandAgg = {
  brandId: string | null
  brandName: string
  orderIds: Set<string>
  prevOrderIds: Set<string>
  salesQty: number
}

// KST 일자 경계를 명시 offset(+09:00)으로 만든다. `new Date(ymd)` + setHours 는
// 서버 로컬 타임존(Vercel=UTC)에 의존해 9시간 어긋나므로 쓰지 않는다.
// (product-ranking·rocket-revenue 와 동일 패턴 — DelOrder.orderDate KST instant 정렬.)

/** YYYY-MM-DD → 그 날 KST 00:00:00. DelOrder.orderDate 와 비교용. */
function startOfDayKst(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+09:00`)
}

/** YYYY-MM-DD → 그 날 KST 23:59:59.999. */
function endOfDayKst(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999+09:00`)
}

/**
 * 한 기간 [from, to] 의 수동채널+로켓 매출·주문 합계.
 * rocketCh 가 있으면 로켓 VENDOR 매출·주문을 합산한다.
 */
async function aggregateRevenue(
  spaceId: string,
  channelIds: string[],
  hasRocket: boolean,
  fromYmd: string,
  toYmd: string
): Promise<{ revenue: number; orderCount: number }> {
  const from = startOfDayKst(fromYmd)
  const to = endOfDayKst(toYmd)

  const orders =
    channelIds.length > 0
      ? await prisma.delOrder.findMany({
          where: { spaceId, channelId: { in: channelIds }, orderDate: { gte: from, lte: to } },
          select: { paymentAmount: true },
        })
      : []

  let revenue = 0
  for (const o of orders) revenue += Number(o.paymentAmount ?? 0)
  let orderCount = orders.length

  if (hasRocket) {
    const rocket = sumRocketDaily(await loadRocketDailyRevenue(spaceId, from, to))
    revenue += rocket.revenue
    orderCount += rocket.orderCount
  }

  return { revenue: Math.round(revenue), orderCount }
}

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id

  // ── 기간: 이번달 1일~오늘(MTD) vs 지난달 1일~같은 날 ──────────────────────
  const today = getTodayStrKst()
  const current = { from: startOfMonth(today), to: today }
  const prev = prevRangeForUnit('월', current)
  const recent30 = last30DaysRange()

  const curFrom = startOfDayKst(current.from)
  const curTo = endOfDayKst(current.to)
  const prevFrom = startOfDayKst(prev.from)
  const prevTo = endOfDayKst(prev.to)

  // ── 활성 채널 (로켓 식별용) ──────────────────────────────────────────────
  const channels = await prisma.channel.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, externalSource: true },
  })
  const hasRocket = channels.some((c) => c.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH)
  const channelIds = channels.map((c) => c.id)

  // ── 매출·주문 집계 (MTD 현재·이전 + 최근 30일) ───────────────────────────
  const [cur, prv, r30] = await Promise.all([
    aggregateRevenue(spaceId, channelIds, hasRocket, current.from, current.to),
    aggregateRevenue(spaceId, channelIds, hasRocket, prev.from, prev.to),
    aggregateRevenue(spaceId, channelIds, hasRocket, recent30.from, recent30.to),
  ])
  const curRevenue = cur.revenue
  const prevRevenue = prv.revenue
  const curOrderCount = cur.orderCount
  const prevOrderCount = prv.orderCount

  // ── 브랜드별 주문수·판매량 (수동채널 DelOrderItem → 옵션→상품→Brand) ─────
  // 현재 기간만 브랜드별 주문수, 이전 기간은 증감 계산용 주문수만.
  const brandMap = new Map<string, BrandAgg>()
  const ensureBrand = (brandId: string | null, brandName: string): BrandAgg => {
    const key = brandId ?? '__none__'
    let agg = brandMap.get(key)
    if (!agg) {
      agg = { brandId, brandName, orderIds: new Set(), prevOrderIds: new Set(), salesQty: 0 }
      brandMap.set(key, agg)
    }
    return agg
  }

  const itemSelect = {
    quantity: true,
    optionId: true,
    option: {
      select: { product: { select: { brandId: true, brand: { select: { name: true } } } } },
    },
    fulfillments: {
      select: {
        quantity: true,
        option: {
          select: { product: { select: { brandId: true, brand: { select: { name: true } } } } },
        },
      },
    },
    order: { select: { id: true } },
  } as const

  if (channelIds.length > 0) {
    const [curItems, prevItems] = await Promise.all([
      prisma.delOrderItem.findMany({
        where: {
          order: {
            spaceId,
            channelId: { in: channelIds },
            orderDate: { gte: curFrom, lte: curTo },
          },
        },
        select: itemSelect,
      }),
      prisma.delOrderItem.findMany({
        where: {
          order: {
            spaceId,
            channelId: { in: channelIds },
            orderDate: { gte: prevFrom, lte: prevTo },
          },
        },
        select: {
          optionId: true,
          option: {
            select: { product: { select: { brandId: true, brand: { select: { name: true } } } } },
          },
          fulfillments: {
            select: {
              option: {
                select: {
                  product: { select: { brandId: true, brand: { select: { name: true } } } },
                },
              },
            },
          },
          order: { select: { id: true } },
        },
      }),
    ])

    const brandOf = (
      p: { brandId: string | null; brand: { name: string } | null } | null | undefined
    ) => ({
      brandId: p?.brandId ?? null,
      brandName: p?.brand?.name ?? '브랜드 없음',
    })

    for (const it of curItems) {
      if (it.fulfillments.length > 0) {
        for (const f of it.fulfillments) {
          const b = brandOf(f.option?.product)
          const agg = ensureBrand(b.brandId, b.brandName)
          agg.orderIds.add(it.order.id)
          agg.salesQty += f.quantity
        }
      } else if (it.option) {
        const b = brandOf(it.option.product)
        const agg = ensureBrand(b.brandId, b.brandName)
        agg.orderIds.add(it.order.id)
        agg.salesQty += it.quantity
      }
    }

    for (const it of prevItems) {
      if (it.fulfillments.length > 0) {
        for (const f of it.fulfillments) {
          const b = brandOf(f.option?.product)
          ensureBrand(b.brandId, b.brandName).prevOrderIds.add(it.order.id)
        }
      } else if (it.option) {
        const b = brandOf(it.option.product)
        ensureBrand(b.brandId, b.brandName).prevOrderIds.add(it.order.id)
      }
    }
  }

  const byBrand = Array.from(brandMap.values())
    .map((b) => {
      const orderCount = b.orderIds.size
      const prevOrderCnt = b.prevOrderIds.size
      return {
        brandId: b.brandId,
        brandName: b.brandName,
        orderCount,
        prevOrderCount: prevOrderCnt,
        orderPctChange: pctChange(orderCount, prevOrderCnt),
        salesQty: b.salesQty,
      }
    })
    .sort(
      (a, b) =>
        b.orderCount - a.orderCount ||
        b.salesQty - a.salesQty ||
        a.brandName.localeCompare(b.brandName)
    )

  return NextResponse.json({
    period: { current, prev, recent30 },
    totalRevenue: {
      current: curRevenue,
      prev: prevRevenue,
      pctChange: pctChange(curRevenue, prevRevenue),
    },
    totalOrders: {
      current: curOrderCount,
      prev: prevOrderCount,
      pctChange: pctChange(curOrderCount, prevOrderCount),
    },
    recent30Days: {
      revenue: r30.revenue,
      orderCount: r30.orderCount,
    },
    byBrand,
  })
}
