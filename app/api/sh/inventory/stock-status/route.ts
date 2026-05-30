import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import {
  healthRatioBySku,
  statusForSku,
  type HealthDistribution,
  type SkuFact,
  type StatusLabel,
} from '@/lib/inv/metrics'

const NO_BRAND_KEY = '__no_brand__'

function decimalToNumber(d: Prisma.Decimal | null | undefined): number | null {
  if (d === null || d === undefined) return null
  const n = Number(d)
  return Number.isFinite(n) ? n : null
}

/**
 * 재고 현황 API
 * 응답:
 *   - kpis: 워크스페이스 집계 (SKU/수량/가치/부족 SKU)
 *   - brands: 브랜드 → 그룹 트리 (각 노드 totalQty/totalValue/skuCount)
 *   - locations: 위치별 집계 (type 포함)
 *   - products: 상품 단위 롤업 (optionCount/lowOptionCount/outOptionCount/overOptionCount)
 *   - matrix.rows: SKU × 위치 행 (totalQty, byLocation, status, incomingQty)
 *   - groups / locations(legacy): 기존 UI 호환용 (PR-2에서 제거 예정)
 *
 * searchParams: brandId, groupId, q, onlyLow — matrix.rows에만 적용
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { searchParams } = req.nextUrl
  const brandFilter = searchParams.get('brandId')
  const groupFilter = searchParams.get('groupId')
  const qFilter = (searchParams.get('q') ?? '').trim().toLowerCase()
  const onlyLow = searchParams.get('onlyLow') === '1' || searchParams.get('onlyLow') === 'true'

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

  // 입고예정 집계 (PLANNED/ORDERED 상태의 ProductionRun 미입고분)
  // groupBy에서 relation 필터 미지원 → findMany + items include 방식으로 집계
  const pendingRuns = await prisma.productionRun.findMany({
    where: {
      spaceId,
      status: { in: ['PLANNED', 'ORDERED'] },
    },
    select: {
      items: {
        select: { optionId: true, quantity: true },
      },
    },
  })
  const incomingByOption = new Map<string, number>()
  for (const run of pendingRuns) {
    for (const item of run.items) {
      incomingByOption.set(
        item.optionId,
        (incomingByOption.get(item.optionId) ?? 0) + item.quantity
      )
    }
  }

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
    totalQty: number
    totalValue: number
    incomingQty: number
    byLocation: Record<string, number>
    externalCodeByLocation: Record<string, string>
    status: StatusLabel
  }

  const allRows: MatrixRow[] = []
  for (const g of groups) {
    for (const p of g.products) {
      for (const o of p.options) {
        const byLocation: Record<string, number> = {}
        let totalQty = 0
        for (const sl of o.stockLevels) {
          byLocation[sl.locationId] = sl.quantity
          totalQty += sl.quantity
        }
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
          totalQty,
          totalValue,
          incomingQty: incomingByOption.get(o.id) ?? 0,
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
  type BrandAgg = {
    id: string | null
    name: string
    logoUrl: string | null
    groups: Map<string, BrandGroupAgg>
  }

  const brandMap = new Map<string, BrandAgg>()
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
  if (qFilter) {
    // 상품명 전용 검색 (공식 상품명 + 관리 상품명)
    filteredRows = filteredRows.filter((r) => {
      const haystacks = [r.productName, r.productInternalName ?? '']
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
  return NextResponse.json({
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
  })
}
