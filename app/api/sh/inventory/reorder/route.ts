import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { calculateReorder } from '@/lib/inv/reorder-calculator'

const DEFAULT_WINDOW_DAYS = 90
const DEFAULT_LEAD_TIME_DAYS = 7
const DEFAULT_SAFETY_STOCK_QTY = 0

/**
 * 발주 예측 — 옵션 단위 행.
 * - 계산은 옵션 단위(재고/출고)로 수행.
 * - 리드타임/안전재고/분석기간은 상품 단위 config(`InvReorderConfig`)를 공유.
 * - 필터: productId(드롭다운), brandId(드롭다운).
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { searchParams } = req.nextUrl
  const urgentOnly = searchParams.get('urgentOnly') === 'true'
  const reorderNeededOnly = searchParams.get('reorderNeededOnly') === 'true'
  const brandId = searchParams.get('brandId')
  const productIdFilter = searchParams.get('productId')

  const productWhere: Record<string, unknown> = { spaceId }
  if (brandId && brandId !== 'all') {
    productWhere.brandId = brandId === 'none' ? null : brandId
  }
  if (productIdFilter && productIdFilter !== 'all') {
    productWhere.id = productIdFilter
  }

  const products = await prisma.invProduct.findMany({
    where: productWhere,
    select: {
      id: true,
      name: true,
      internalName: true,
      code: true,
      brand: { select: { id: true, name: true } },
      options: { select: { id: true, name: true, sku: true } },
      reorderConfig: true,
    },
    orderBy: { name: 'asc' },
  })

  if (products.length === 0) {
    return NextResponse.json({ data: [], windowDays: DEFAULT_WINDOW_DAYS })
  }

  const optionIds = products.flatMap((p) => p.options.map((o) => o.id))

  // 옵션별 현재 재고
  const stockGroups = optionIds.length
    ? await prisma.invStockLevel.groupBy({
        by: ['optionId'],
        where: { spaceId, optionId: { in: optionIds } },
        _sum: { quantity: true },
      })
    : []
  const stockByOption = new Map<string, number>()
  for (const g of stockGroups) {
    stockByOption.set(g.optionId, g._sum.quantity ?? 0)
  }

  // 분석기간(상품 config) 별로 버킷팅해 1~2회 쿼리만 발생하도록
  const windowBuckets = new Map<number, string[]>()
  for (const p of products) {
    const wd = p.reorderConfig?.analysisWindowDays ?? DEFAULT_WINDOW_DAYS
    const list = windowBuckets.get(wd) ?? []
    list.push(...p.options.map((o) => o.id))
    windowBuckets.set(wd, list)
  }

  const outboundByOption = new Map<string, number>()
  const now = Date.now()
  for (const [wd, ids] of windowBuckets.entries()) {
    if (!ids.length) continue
    const since = new Date(now - wd * 24 * 60 * 60 * 1000)
    const outGroups = await prisma.invMovement.groupBy({
      by: ['optionId'],
      where: {
        spaceId,
        optionId: { in: ids },
        type: 'OUTBOUND',
        movementDate: { gte: since },
      },
      _sum: { quantity: true },
    })
    for (const g of outGroups) {
      outboundByOption.set(g.optionId, g._sum.quantity ?? 0)
    }
  }

  // 옵션 단위 행 생성
  const rows = products.flatMap((p) => {
    const cfg = p.reorderConfig
    const windowDays = cfg?.analysisWindowDays ?? DEFAULT_WINDOW_DAYS
    const leadTimeDays = cfg?.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS
    const safetyStockQty = cfg?.safetyStockQty ?? DEFAULT_SAFETY_STOCK_QTY

    const displayName = p.internalName && p.internalName.trim().length > 0 ? p.internalName : p.name
    return p.options.map((o) => {
      const currentStock = stockByOption.get(o.id) ?? 0
      const totalOutbound = outboundByOption.get(o.id) ?? 0
      const calc = calculateReorder({
        totalOutbound,
        windowDays,
        leadTimeDays,
        safetyStockQty,
        currentStock,
      })
      return {
        productId: p.id,
        // 내부 표시용 — 관리명 우선, 없으면 공식명
        productName: displayName,
        productCode: p.code,
        brandId: p.brand?.id ?? null,
        brandName: p.brand?.name ?? null,
        optionId: o.id,
        optionName: o.name,
        sku: o.sku ?? null,
        currentStock,
        totalOutbound,
        windowDays,
        dailyAvgOutbound: calc.dailyAvgOutbound,
        leadTimeDays,
        safetyStockQty,
        neededStock: calc.neededStock,
        reorderQty: calc.reorderQty,
        estimatedDepletionDays: calc.estimatedDepletionDays,
        isUrgent: calc.isUrgent,
        hasConfig: !!cfg,
      }
    })
  })

  let filtered = rows
  if (urgentOnly) filtered = filtered.filter((r) => r.isUrgent)
  if (reorderNeededOnly) filtered = filtered.filter((r) => r.reorderQty > 0)

  // 정렬: 같은 상품의 옵션이 연속되도록 productName 우선, 그다음 긴급/발주필요
  filtered.sort((a, b) => {
    if (a.productName !== b.productName) return a.productName.localeCompare(b.productName)
    if (b.reorderQty !== a.reorderQty) return b.reorderQty - a.reorderQty
    const ad = a.estimatedDepletionDays
    const bd = b.estimatedDepletionDays
    if (ad === null && bd === null) return 0
    if (ad === null) return 1
    if (bd === null) return -1
    return ad - bd
  })

  return NextResponse.json({ data: filtered, windowDays: DEFAULT_WINDOW_DAYS })
}
