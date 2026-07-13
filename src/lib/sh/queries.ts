/**
 * 브랜드 운영(seller-hub) Deck — 조회(read) 로직 단일 소스.
 * app/api/sh/* route와 MCP tool이 동일한 함수를 공유하기 위해
 * 각 route의 인라인 쿼리/집계 로직을 기계적으로 이동한 것.
 *
 * ⚠️ 규약:
 *  - 이 파일의 함수는 순수 read다(mutate 금지).
 *  - URLSearchParams·NextRequest·NextResponse를 다루지 않는다.
 *    파라미터는 이미 파싱된 타입 인자로 받고, route가 NextResponse.json에 넘기던 바로 그 객체를 반환한다.
 *  - "현재 시각" 의존(getTodayStrKst/last30DaysRange/Date.now/new Date())은 함수 본문에 그대로 둔다.
 *    → tool 호출 시에도 route와 동일하게 매 호출 최신 스냅샷을 반환한다.
 */
import { Prisma } from '@/generated/prisma/client'
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
import { healthRatioBySku, statusForSku, type SkuFact, type StatusLabel } from '@/lib/inv/metrics'
import { plannedStockQty, sumIncomingProductionQtyByOption } from '@/lib/inv/planned-stock'
import { productDisplayName } from '@/lib/sh/product-display'
import { loadRocketDailyOptionQty } from '@/lib/inv/coupang-sales-to-movement'

// ────────────────────────────────────────────────────────────────────────────
// sales-summary
// ────────────────────────────────────────────────────────────────────────────

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

/** GET /api/sh/dashboard/sales-summary 대응 — 이번달(MTD) vs 지난달 동기간 매출·주문 + 최근 30일 + 브랜드별. */
export async function querySalesSummary(spaceId: string) {
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

  return {
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
  }
}

// ────────────────────────────────────────────────────────────────────────────
// stock-status
// ────────────────────────────────────────────────────────────────────────────

const NO_BRAND_KEY = '__no_brand__'

function decimalToNumber(d: Prisma.Decimal | null | undefined): number | null {
  if (d === null || d === undefined) return null
  const n = Number(d)
  return Number.isFinite(n) ? n : null
}

export interface QueryStockStatusOptions {
  brandId?: string | null
  groupId?: string | null
  productId?: string | null
  q?: string | null
  onlyLow?: boolean
}

/**
 * GET /api/sh/inventory/stock-status 대응 — 재고 현황.
 * 응답:
 *   - kpis: 워크스페이스 집계 (SKU/수량/가치/부족 SKU)
 *   - brands: 브랜드 → 그룹 트리 (각 노드 totalQty/totalValue/skuCount)
 *   - locations: 위치별 집계 (type 포함)
 *   - products: 상품 단위 롤업 (optionCount/lowOptionCount/outOptionCount/overOptionCount)
 *   - matrix.rows: SKU × 위치 행 (totalQty, byLocation, status, incomingQty)
 *   - groups / locations(legacy): 기존 UI 호환용 (PR-2에서 제거 예정)
 *
 * 필터(brandId, groupId, productId, q, onlyLow)는 matrix.rows에만 적용.
 * q 는 raw 문자열을 받아 여기서 trim·lowercase 정규화한다(route의 검색 정규화와 동일).
 */
export async function queryStockStatus(spaceId: string, opts: QueryStockStatusOptions = {}) {
  const brandFilter = opts.brandId ?? null
  const groupFilter = opts.groupId ?? null
  const productFilter = opts.productId ?? null
  const qFilter = (opts.q ?? '').trim().toLowerCase()
  const onlyLow = opts.onlyLow === true

  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000)
  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const since90d = new Date(Date.now() - 90 * 24 * 3600 * 1000)

  // 위치 목록 (type 포함)
  const locations = await prisma.invStorageLocation.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, name: true, type: true },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  })

  // 옵션 × 위치 → externalCode 매핑 (재고 현황 export 시 사용)
  const mapItems = await prisma.invLocationProductMapItem.findMany({
    where: { map: { spaceId } },
    select: {
      optionId: true,
      map: { select: { locationId: true, externalCode: true } },
    },
  })
  const externalCodeByOptionLocation = new Map<string, Map<string, string>>()
  for (const it of mapItems) {
    const inner = externalCodeByOptionLocation.get(it.optionId) ?? new Map<string, string>()
    // 같은 옵션 × 위치 매핑이 여러 개면 첫 번째 유지
    if (!inner.has(it.map.locationId)) inner.set(it.map.locationId, it.map.externalCode)
    externalCodeByOptionLocation.set(it.optionId, inner)
  }

  // 최근 7일 OUTBOUND 집계 (legacy outbound7d 호환용)
  const outbound7dAgg = await prisma.invMovement.groupBy({
    by: ['optionId'],
    where: { spaceId, type: 'OUTBOUND', movementDate: { gte: since7d } },
    _sum: { quantity: true },
  })
  const outbound7dByOption = new Map(
    outbound7dAgg.map((a) => [a.optionId, Math.abs(a._sum.quantity ?? 0)])
  )

  // 최근 30일 판매채널 OUTBOUND 집계 (상태 판정: LOW 기준)
  const outbound30dAgg = await prisma.invMovement.groupBy({
    by: ['optionId'],
    where: {
      spaceId,
      type: 'OUTBOUND',
      movementDate: { gte: since30d },
      channelId: { not: null },
    },
    _sum: { quantity: true },
  })
  const outbound30dByOption = new Map(
    outbound30dAgg.map((a) => [a.optionId, Math.abs(a._sum.quantity ?? 0)])
  )

  // 최근 90일 판매채널 OUTBOUND 집계 (상태 판정: OVER 기준)
  const outbound90dAgg = await prisma.invMovement.groupBy({
    by: ['optionId'],
    where: {
      spaceId,
      type: 'OUTBOUND',
      movementDate: { gte: since90d },
      channelId: { not: null },
    },
    _sum: { quantity: true },
  })
  const outbound90dByOption = new Map(
    outbound90dAgg.map((a) => [a.optionId, Math.abs(a._sum.quantity ?? 0)])
  )

  // 입고예정 집계 (진행중 상태의 ProductionRun 미입고분)
  // groupBy에서 relation 필터 미지원 → findMany + items include 방식으로 집계
  const pendingRuns = await prisma.productionRun.findMany({
    where: {
      spaceId,
      status: 'ORDERED',
    },
    select: {
      status: true,
      items: {
        select: { optionId: true, quantity: true },
      },
    },
  })
  const incomingByOption = sumIncomingProductionQtyByOption(pendingRuns)

  // 그룹 → 상품 → 옵션 + 재고 + 브랜드 트리 조회
  const groups = await prisma.invProductGroup.findMany({
    where: { spaceId },
    select: {
      id: true,
      name: true,
      products: {
        where: { spaceId },
        select: {
          id: true,
          name: true,
          internalName: true,
          code: true,
          brand: { select: { id: true, name: true, logoUrl: true } },
          options: {
            select: {
              id: true,
              name: true,
              sku: true,
              costPrice: true,
              retailPrice: true,
              safetyStockQty: true,
              stockLevels: {
                select: { locationId: true, quantity: true },
              },
            },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  })

  // ───────────────────────────────────────────────────────────────────
  // 1. legacy shaped 응답 (기존 UI 호환)
  // ───────────────────────────────────────────────────────────────────
  const legacyShaped = groups.map((g) => ({
    groupId: g.id,
    groupName: g.name,
    products: g.products.map((p) => ({
      productId: p.id,
      productName: p.name,
      productCode: p.code ?? null,
      options: p.options.map((o) => {
        const stockByLocation = o.stockLevels.map((sl) => ({
          locationId: sl.locationId,
          locationName: locations.find((l) => l.id === sl.locationId)?.name ?? '(알 수 없음)',
          quantity: sl.quantity,
        }))
        const totalStock = o.stockLevels.reduce((sum, sl) => sum + sl.quantity, 0)
        return {
          optionId: o.id,
          optionName: o.name,
          sku: o.sku ?? null,
          stockByLocation,
          totalStock,
          outbound7d: outbound7dByOption.get(o.id) ?? 0,
        }
      }),
    })),
  }))

  // ───────────────────────────────────────────────────────────────────
  // 2. matrix.rows 생성
  // ───────────────────────────────────────────────────────────────────
  type MatrixRow = {
    optionId: string
    sku: string | null
    optionName: string
    productId: string
    productName: string
    productInternalName: string | null
    productCode: string | null
    brandId: string | null
    brandName: string | null
    groupId: string
    groupName: string
    costPrice: number | null
    retailPrice: number | null
    safetyStockQty: number
    currentQty: number
    totalQty: number
    totalValue: number
    incomingQty: number
    out30d: number
    out90d: number
    byLocation: Record<string, number>
    externalCodeByLocation: Record<string, string>
    status: StatusLabel
  }

  const allRows: MatrixRow[] = []
  for (const g of groups) {
    for (const p of g.products) {
      for (const o of p.options) {
        const byLocation: Record<string, number> = {}
        let currentQty = 0
        for (const sl of o.stockLevels) {
          byLocation[sl.locationId] = sl.quantity
          currentQty += sl.quantity
        }
        const incomingQty = incomingByOption.get(o.id) ?? 0
        const totalQty = plannedStockQty({ onHandQty: currentQty, incomingQty })
        const costPrice = decimalToNumber(o.costPrice)
        const totalValue = costPrice !== null ? Math.round(costPrice * totalQty) : 0
        const out30d = outbound30dByOption.get(o.id) ?? 0
        const out90d = outbound90dByOption.get(o.id) ?? 0
        const externalCodeByLocation: Record<string, string> = {}
        const optionMap = externalCodeByOptionLocation.get(o.id)
        if (optionMap) {
          for (const [locId, code] of optionMap) externalCodeByLocation[locId] = code
        }
        allRows.push({
          optionId: o.id,
          sku: o.sku ?? null,
          optionName: o.name,
          productId: p.id,
          productName: p.name,
          productInternalName: p.internalName ?? null,
          productCode: p.code ?? null,
          brandId: p.brand?.id ?? null,
          brandName: p.brand?.name ?? null,
          groupId: g.id,
          groupName: g.name,
          costPrice,
          retailPrice: decimalToNumber(o.retailPrice),
          safetyStockQty: o.safetyStockQty,
          currentQty,
          totalQty,
          totalValue,
          incomingQty,
          out30d,
          out90d,
          byLocation,
          externalCodeByLocation,
          status: statusForSku(totalQty, out30d, out90d),
        })
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // 3. KPI 집계 (필터 적용 전 전체 기준)
  // ───────────────────────────────────────────────────────────────────
  let totalQty = 0
  let totalValue = 0
  const skuFacts: SkuFact[] = []
  for (const r of allRows) {
    totalQty += r.totalQty
    totalValue += r.totalValue
    skuFacts.push({
      optionId: r.optionId,
      stock: r.totalQty,
      out30d: outbound30dByOption.get(r.optionId) ?? 0,
      out90d: outbound90dByOption.get(r.optionId) ?? 0,
    })
  }
  const overallHealth = healthRatioBySku(skuFacts)
  const lowStockCount = overallHealth.low + overallHealth.out

  // ───────────────────────────────────────────────────────────────────
  // 4. 브랜드 트리 집계
  // ───────────────────────────────────────────────────────────────────
  type BrandGroupAgg = {
    id: string
    name: string
    productIds: Set<string>
    skuFacts: SkuFact[]
    totalQty: number
    totalValue: number
  }
  type BrandTreeAgg = {
    id: string | null
    name: string
    logoUrl: string | null
    groups: Map<string, BrandGroupAgg>
  }

  const brandMap = new Map<string, BrandTreeAgg>()
  for (const r of allRows) {
    const bKey = r.brandId ?? NO_BRAND_KEY
    if (!brandMap.has(bKey)) {
      brandMap.set(bKey, {
        id: r.brandId,
        name: r.brandName ?? '브랜드 없음',
        logoUrl: null,
        groups: new Map(),
      })
    }
    const bAgg = brandMap.get(bKey)!
    if (!bAgg.groups.has(r.groupId)) {
      bAgg.groups.set(r.groupId, {
        id: r.groupId,
        name: r.groupName,
        productIds: new Set(),
        skuFacts: [],
        totalQty: 0,
        totalValue: 0,
      })
    }
    const gAgg = bAgg.groups.get(r.groupId)!
    gAgg.productIds.add(r.productId)
    gAgg.totalQty += r.totalQty
    gAgg.totalValue += r.totalValue
    gAgg.skuFacts.push({
      optionId: r.optionId,
      stock: r.totalQty,
      out30d: outbound30dByOption.get(r.optionId) ?? 0,
      out90d: outbound90dByOption.get(r.optionId) ?? 0,
    })
  }

  // 브랜드 로고 보강 (rows에는 brand.logoUrl이 없음)
  const brandLogoMap = new Map<string, string | null>()
  for (const g of groups) {
    for (const p of g.products) {
      if (p.brand?.id) brandLogoMap.set(p.brand.id, p.brand.logoUrl)
    }
  }
  for (const b of brandMap.values()) {
    if (b.id) b.logoUrl = brandLogoMap.get(b.id) ?? null
  }

  const brands = Array.from(brandMap.values()).map((b) => {
    const groupItems = Array.from(b.groups.values()).map((g) => ({
      id: g.id,
      name: g.name,
      productCount: g.productIds.size,
      skuCount: g.skuFacts.length,
      totalQty: g.totalQty,
      totalValue: g.totalValue,
      healthRatio: healthRatioBySku(g.skuFacts),
    }))
    const brandSkuFacts: SkuFact[] = Array.from(b.groups.values()).flatMap((g) => g.skuFacts)
    return {
      id: b.id,
      name: b.name,
      logoUrl: b.logoUrl,
      groups: groupItems,
      healthRatio: healthRatioBySku(brandSkuFacts),
    }
  })

  // ───────────────────────────────────────────────────────────────────
  // 5. 위치별 집계 (healthDistribution 제거 — Phase2에서 도넛 차트로 대체)
  // ───────────────────────────────────────────────────────────────────
  const locationAgg = new Map<string, { skuCount: number; totalQty: number; totalValue: number }>()
  for (const l of locations) locationAgg.set(l.id, { skuCount: 0, totalQty: 0, totalValue: 0 })
  // 위치별 상품 수량 집계 (도넛 드릴다운용 — 필터 무관 전체 기준)
  const productByLocation = new Map<string, Map<string, { name: string; qty: number }>>()
  for (const l of locations) productByLocation.set(l.id, new Map())
  for (const r of allRows) {
    for (const [locId, qty] of Object.entries(r.byLocation)) {
      const agg = locationAgg.get(locId)
      if (!agg) continue
      agg.skuCount += 1
      agg.totalQty += qty
      agg.totalValue += r.costPrice !== null ? Math.round(r.costPrice * qty) : 0
      const pm = productByLocation.get(locId)!
      const entry = pm.get(r.productId)
      if (entry) entry.qty += qty
      else pm.set(r.productId, { name: r.productName, qty })
    }
  }
  const locationsResp = locations.map((l) => {
    const pm = productByLocation.get(l.id) ?? new Map()
    const productBreakdown = Array.from(pm.entries())
      .map(([productId, v]) => ({ productId, productName: v.name, qty: v.qty }))
      .filter((p) => p.qty > 0)
      .sort((a, b) => b.qty - a.qty)
    return {
      id: l.id,
      name: l.name,
      type: l.type,
      skuCount: locationAgg.get(l.id)?.skuCount ?? 0,
      totalQty: locationAgg.get(l.id)?.totalQty ?? 0,
      totalValue: locationAgg.get(l.id)?.totalValue ?? 0,
      productBreakdown,
    }
  })

  // ───────────────────────────────────────────────────────────────────
  // 6. 상품 단위 롤업 (allRows를 productId로 집계)
  // ───────────────────────────────────────────────────────────────────
  type ProductRollup = {
    productId: string
    productName: string
    optionCount: number
    okOptionCount: number
    lowOptionCount: number
    outOptionCount: number
    overOptionCount: number
  }

  const productRollupMap = new Map<string, ProductRollup>()
  for (const r of allRows) {
    if (!productRollupMap.has(r.productId)) {
      productRollupMap.set(r.productId, {
        productId: r.productId,
        productName: r.productName,
        optionCount: 0,
        okOptionCount: 0,
        lowOptionCount: 0,
        outOptionCount: 0,
        overOptionCount: 0,
      })
    }
    const rollup = productRollupMap.get(r.productId)!
    rollup.optionCount += 1
    if (r.status === 'LOW') rollup.lowOptionCount += 1
    else if (r.status === 'OUT') rollup.outOptionCount += 1
    else if (r.status === 'OVER') rollup.overOptionCount += 1
    else rollup.okOptionCount += 1 // 결품·부족·과잉 아닌 = 정상(OK)
  }
  const products = Array.from(productRollupMap.values()).sort((a, b) =>
    a.productName.localeCompare(b.productName, 'ko')
  )

  // ───────────────────────────────────────────────────────────────────
  // 7. matrix.rows 필터링 (searchParams)
  // ───────────────────────────────────────────────────────────────────
  let filteredRows = allRows
  if (brandFilter && brandFilter !== 'all') {
    if (brandFilter === 'none') {
      filteredRows = filteredRows.filter((r) => r.brandId === null)
    } else {
      filteredRows = filteredRows.filter((r) => r.brandId === brandFilter)
    }
  }
  if (groupFilter && groupFilter !== 'all') {
    filteredRows = filteredRows.filter((r) => r.groupId === groupFilter)
  }
  if (productFilter && productFilter !== 'all') {
    filteredRows = filteredRows.filter((r) => r.productId === productFilter)
  }
  if (qFilter) {
    // 옵션 테이블 검색: 옵션명, SKU, 상품명, 관리 상품명, 위치별 외부코드
    filteredRows = filteredRows.filter((r) => {
      const haystacks = [
        r.optionName,
        r.sku ?? '',
        r.productName,
        r.productInternalName ?? '',
        ...Object.values(r.externalCodeByLocation),
      ]
      return haystacks.some((h) => h.toLowerCase().includes(qFilter))
    })
  }
  if (onlyLow) {
    // 토글 라벨이 "부족·결품만" — 과잉(OVER)은 제외
    filteredRows = filteredRows.filter((r) => r.status === 'LOW' || r.status === 'OUT')
  }

  // ───────────────────────────────────────────────────────────────────
  // 8. 응답
  // ───────────────────────────────────────────────────────────────────
  return {
    snapshotAt: new Date().toISOString(),
    kpis: {
      totalSkus: allRows.length,
      totalQty,
      totalValue,
      lowStockCount,
    },
    overallHealth,
    brands,
    locations: locationsResp,
    products,
    matrix: { rows: filteredRows },
    // legacy (PR-2에서 제거)
    groups: legacyShaped,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// reorder-status
// ────────────────────────────────────────────────────────────────────────────

const RECENT_MEASURED_DAYS = 14

/** GET /api/sh/dashboard/reorder-status 대응 — 초안 발주 + 예측 검증(ELIGIBLE/MEASURED) 롤업. */
export async function queryReorderStatus(spaceId: string) {
  const recentCutoff = new Date(Date.now() - RECENT_MEASURED_DAYS * 24 * 60 * 60 * 1000)

  const [draftPlans, accuracyRows] = await Promise.all([
    // 초안 발주 계획 (미대체)
    prisma.reorderPlan.findMany({
      where: { spaceId, status: 'DRAFT', supersededAt: null },
      select: {
        id: true,
        planNo: true,
        createdAt: true,
        product: { select: { name: true, internalName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    // 유효(ACTIVE) accuracy 레코드 — 옵션 단위. 계획 단위 집계용.
    // ELIGIBLE 은 전체(정산 대기), MEASURED 는 최근만(결과 확인).
    prisma.reorderPlanAccuracy.findMany({
      where: {
        plan: { spaceId },
        validity: 'ACTIVE',
        OR: [
          { evaluationStatus: 'ELIGIBLE' },
          { evaluationStatus: 'MEASURED', evaluatedAt: { gte: recentCutoff } },
        ],
      },
      select: { planId: true, evaluationStatus: true, evaluatedAt: true },
    }),
  ])

  // 발주 계획(planId) 단위로 상태 롤업 — 한 계획에 ELIGIBLE/MEASURED 옵션이 섞이면
  // ELIGIBLE(정산 대기)을 우선 노출(액션 필요).
  const planStatus = new Map<string, { status: 'ELIGIBLE' | 'MEASURED'; evaluatedAt: Date }>()
  for (const r of accuracyRows) {
    const prev = planStatus.get(r.planId)
    if (!prev) {
      planStatus.set(r.planId, {
        status: r.evaluationStatus as 'ELIGIBLE' | 'MEASURED',
        evaluatedAt: r.evaluatedAt,
      })
    } else {
      // ELIGIBLE 이 하나라도 있으면 ELIGIBLE 로 격상
      if (r.evaluationStatus === 'ELIGIBLE') prev.status = 'ELIGIBLE'
      if (r.evaluatedAt > prev.evaluatedAt) prev.evaluatedAt = r.evaluatedAt
    }
  }

  let eligiblePlanCount = 0
  let measuredPlanCount = 0
  for (const v of planStatus.values()) {
    if (v.status === 'ELIGIBLE') eligiblePlanCount += 1
    else measuredPlanCount += 1
  }

  const draftSamples = draftPlans.slice(0, 5).map((p) => ({
    planId: p.id,
    planNo: p.planNo,
    productName: p.product ? productDisplayName(p.product) : '전체 계획',
  }))

  return {
    draftPlanCount: draftPlans.length,
    draftSamples,
    eligiblePlanCount,
    measuredPlanCount,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// product-ranking
// ────────────────────────────────────────────────────────────────────────────

type ProductAcc = {
  productId: string
  productName: string
  orderIds: Set<string>
  salesQty: number
}

/** GET /api/sh/dashboard/product-ranking 대응 — 최근 30일 주문건수 기준 상위/부진 상품(각 5개). */
export async function queryProductRanking(spaceId: string) {
  const window = last30DaysRange()
  const from = new Date(`${window.from}T00:00:00+09:00`)
  const to = new Date(`${window.to}T23:59:59.999+09:00`)

  // ── 수동채널 주문 라인 → 상품별 주문건수·판매량 집계 ─────────────────────
  const items = await prisma.delOrderItem.findMany({
    where: { order: { spaceId, orderDate: { gte: from, lte: to } } },
    select: {
      quantity: true,
      optionId: true,
      option: {
        select: { product: { select: { id: true, name: true, internalName: true } } },
      },
      fulfillments: {
        select: {
          quantity: true,
          option: { select: { product: { select: { id: true, name: true, internalName: true } } } },
        },
      },
      order: { select: { id: true } },
    },
  })

  const acc = new Map<string, ProductAcc>()
  const add = (
    p: { id: string; name: string; internalName: string | null },
    orderId: string,
    qty: number
  ) => {
    let entry = acc.get(p.id)
    if (!entry) {
      entry = {
        productId: p.id,
        productName: productDisplayName(p),
        orderIds: new Set(),
        salesQty: 0,
      }
      acc.set(p.id, entry)
    }
    entry.orderIds.add(orderId)
    entry.salesQty += qty
  }

  for (const it of items) {
    if (it.fulfillments.length > 0) {
      for (const f of it.fulfillments) {
        if (f.option?.product) add(f.option.product, it.order.id, f.quantity)
      }
    } else if (it.option?.product) {
      add(it.option.product, it.order.id, it.quantity)
    }
  }

  const ranked = Array.from(acc.values()).map((e) => ({
    productId: e.productId,
    productName: e.productName,
    orderCount: e.orderIds.size,
    salesQty: e.salesQty,
  }))

  // ── 상위: 주문건수 desc ───────────────────────────────────────────────────
  const top = [...ranked]
    .sort((a, b) => b.orderCount - a.orderCount || b.salesQty - a.salesQty)
    .slice(0, 5)

  // ── 로켓그로스 판매 상품 집합 (부진 오탐 제외용) ──────────────────────────
  // 로켓은 옵션/상품별 주문건수가 없어 상위 랭킹엔 못 쓰지만, 판매량(quantity)으로
  // "이 상품은 로켓에서 팔리고 있다"는 사실은 알 수 있다 → 부진 후보에서 제외.
  const rocketRows = await loadRocketDailyOptionQty(spaceId, from, to)
  const rocketSoldProductIds = new Set<string>()
  for (const r of rocketRows) {
    if (r.quantity > 0) rocketSoldProductIds.add(r.productId)
  }

  // ── 부진: ACTIVE 상품 카탈로그 left-join (0판매 포함) ─────────────────────
  // 윈도우 시작 전부터 존재한 ACTIVE 상품만 (신규 상품 오탐 방지).
  // 로켓 판매가 있는 상품은 제외 (직접배송 주문이 0이어도 진짜 부진 아님).
  const activeProducts = await prisma.invProduct.findMany({
    where: { spaceId, status: 'ACTIVE', createdAt: { lt: from } },
    select: { id: true, name: true, internalName: true },
  })

  const orderCountByProduct = new Map(ranked.map((r) => [r.productId, r]))
  const bottom = activeProducts
    .filter((p) => !rocketSoldProductIds.has(p.id))
    .map((p) => {
      const hit = orderCountByProduct.get(p.id)
      return {
        productId: p.id,
        productName: productDisplayName(p),
        orderCount: hit?.orderCount ?? 0,
        salesQty: hit?.salesQty ?? 0,
      }
    })
    .sort((a, b) => a.orderCount - b.orderCount || a.salesQty - b.salesQty)
    .slice(0, 5)

  return { window, top, bottom }
}
