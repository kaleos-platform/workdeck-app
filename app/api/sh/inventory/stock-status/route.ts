import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import {
  healthRatioByCell,
  healthRatioBySku,
  LOW_STOCK_THRESHOLD,
  statusForSku,
  turnoverDays,
  type CellFact,
  type HealthDistribution,
  type SkuFact,
  type StatusLabel,
} from '@/lib/inv/metrics'

const NO_BRAND_KEY = '__no_brand__'
const TURNOVER_WINDOW_DAYS = 30

function decimalToNumber(d: Prisma.Decimal | null | undefined): number | null {
  if (d === null || d === undefined) return null
  const n = Number(d)
  return Number.isFinite(n) ? n : null
}

/**
 * 재고 현황 API
 * 응답:
 *   - kpis: 워크스페이스 집계 (브랜드/SKU/수량/가치/부족 SKU)
 *   - brands: 브랜드 → 그룹 트리 (각 노드 totalQty/totalValue/skuCount)
 *   - locations: 위치별 집계 (type 포함)
 *   - matrix.rows: SKU × 위치 행 (totalQty, byLocation, status)
 *   - alerts: 결품/부족 알림 (severity 정렬, 상위 N)
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
  const since30d = new Date(Date.now() - TURNOVER_WINDOW_DAYS * 24 * 3600 * 1000)

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

  // 최근 30일 OUTBOUND 집계 (회전일 계산용)
  const outbound30dAgg = await prisma.invMovement.groupBy({
    by: ['optionId'],
    where: { spaceId, type: 'OUTBOUND', movementDate: { gte: since30d } },
    _sum: { quantity: true },
  })
  const outbound30dByOption = new Map(
    outbound30dAgg.map((a) => [a.optionId, Math.abs(a._sum.quantity ?? 0)])
  )

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
    byLocation: Record<string, number>
    externalCodeByLocation: Record<string, string>
    status: StatusLabel
    turnoverDays: number | null
  }

  // 셀 단위 fact 수집 (위치 분포 카드의 healthDistribution용)
  const cellFactsByLocation = new Map<string, CellFact[]>()
  for (const l of locations) cellFactsByLocation.set(l.id, [])

  const allRows: MatrixRow[] = []
  for (const g of groups) {
    for (const p of g.products) {
      for (const o of p.options) {
        const byLocation: Record<string, number> = {}
        let totalQty = 0
        // 옵션 단위 안전재고를 보유 위치 수로 균등 분배해 셀별 임계 추정
        const numLocations = o.stockLevels.length
        const safetyAtCell = numLocations > 0 ? Math.ceil(o.safetyStockQty / numLocations) : 0
        for (const sl of o.stockLevels) {
          byLocation[sl.locationId] = sl.quantity
          totalQty += sl.quantity
          cellFactsByLocation.get(sl.locationId)?.push({
            optionId: o.id,
            locationId: sl.locationId,
            available: sl.quantity,
            safetyAtCell,
          })
        }
        const costPrice = decimalToNumber(o.costPrice)
        const totalValue = costPrice !== null ? Math.round(costPrice * totalQty) : 0
        const out30d = outbound30dByOption.get(o.id) ?? 0
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
          byLocation,
          externalCodeByLocation,
          status: statusForSku(totalQty, o.safetyStockQty),
          turnoverDays: turnoverDays(totalQty, out30d, TURNOVER_WINDOW_DAYS),
        })
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // 3. KPI 집계 (필터 적용 전 전체 기준)
  // ───────────────────────────────────────────────────────────────────
  let totalQty = 0
  let totalValue = 0
  const brandIdSet = new Set<string>()
  const skuFacts: SkuFact[] = []
  for (const r of allRows) {
    totalQty += r.totalQty
    totalValue += r.totalValue
    if (r.brandId) brandIdSet.add(r.brandId)
    skuFacts.push({
      optionId: r.optionId,
      totalAvailable: r.totalQty,
      totalSafetyStock: r.safetyStockQty,
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
      totalAvailable: r.totalQty,
      totalSafetyStock: r.safetyStockQty,
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
  // 5. 위치별 집계
  // ───────────────────────────────────────────────────────────────────
  const locationAgg = new Map<string, { skuCount: number; totalQty: number; totalValue: number }>()
  for (const l of locations) locationAgg.set(l.id, { skuCount: 0, totalQty: 0, totalValue: 0 })
  for (const r of allRows) {
    for (const [locId, qty] of Object.entries(r.byLocation)) {
      const agg = locationAgg.get(locId)
      if (!agg) continue
      agg.skuCount += 1
      agg.totalQty += qty
      agg.totalValue += r.costPrice !== null ? Math.round(r.costPrice * qty) : 0
    }
  }
  const locationsResp = locations.map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type,
    skuCount: locationAgg.get(l.id)?.skuCount ?? 0,
    totalQty: locationAgg.get(l.id)?.totalQty ?? 0,
    totalValue: locationAgg.get(l.id)?.totalValue ?? 0,
    healthDistribution: healthRatioByCell(cellFactsByLocation.get(l.id) ?? []),
  }))

  // ───────────────────────────────────────────────────────────────────
  // 6. matrix.rows 필터링 (searchParams)
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
    filteredRows = filteredRows.filter((r) => r.status !== 'OK')
  }

  // ───────────────────────────────────────────────────────────────────
  // 7. alerts — 결품/부족 옵션 상위 20개 (severity 우선, 부족분 큰 순)
  // ───────────────────────────────────────────────────────────────────
  const alertRows = allRows
    .filter((r) => r.status !== 'OK')
    .map((r) => {
      const effectiveSafety = r.safetyStockQty > 0 ? r.safetyStockQty : LOW_STOCK_THRESHOLD
      return {
        optionId: r.optionId,
        sku: r.sku,
        productName: r.productName,
        severity: r.status === 'OUT' ? 'OUT' : 'LOW',
        qty: r.totalQty,
        safetyStockQty: r.safetyStockQty,
        effectiveSafety,
        message:
          r.status === 'OUT'
            ? '재고 없음 (결품)'
            : `안전재고 미달 — 현재 ${r.totalQty} / 안전 ${effectiveSafety}`,
        occurredAt: new Date().toISOString(),
      }
    })
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'OUT' ? -1 : 1
      const aShort = Math.max(0, a.effectiveSafety - a.qty)
      const bShort = Math.max(0, b.effectiveSafety - b.qty)
      return bShort - aShort
    })
    .slice(0, 20)
    .map(({ effectiveSafety: _e, ...rest }) => rest)

  // ───────────────────────────────────────────────────────────────────
  // 8. 응답
  // ───────────────────────────────────────────────────────────────────
  // 평균 회전일 — null이 아닌 row만 평균
  const turnoverValues = allRows.map((r) => r.turnoverDays).filter((v): v is number => v !== null)
  const averageTurnoverDays =
    turnoverValues.length > 0
      ? Math.round((turnoverValues.reduce((s, v) => s + v, 0) / turnoverValues.length) * 10) / 10
      : null

  return NextResponse.json({
    snapshotAt: new Date().toISOString(),
    kpis: {
      totalBrands: brandIdSet.size,
      totalSkus: allRows.length,
      totalQty,
      totalValue,
      lowStockCount,
      averageTurnoverDays,
    },
    overallHealth,
    brands,
    locations: locationsResp,
    matrix: { rows: filteredRows },
    alerts: alertRows,
    // legacy (PR-2에서 제거)
    groups: legacyShaped,
  })
}
