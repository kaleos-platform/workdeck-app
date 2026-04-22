import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { calculateReorder } from '@/lib/inv/reorder-calculator'

const DEFAULT_WINDOW_DAYS = 90
const DEFAULT_LEAD_TIME_DAYS = 7
const DEFAULT_SAFETY_STOCK_QTY = 0

/**
 * 상품 단위 발주 예측.
 * - 한 상품의 모든 옵션 재고/출고를 합산한 뒤 상품별 reorderConfig로 계산한다.
 * - 필터: search(상품명·코드 부분일치), brandId.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { searchParams } = req.nextUrl
  const urgentOnly = searchParams.get('urgentOnly') === 'true'
  const reorderNeededOnly = searchParams.get('reorderNeededOnly') === 'true'
  const search = (searchParams.get('search') ?? '').trim()
  const brandId = searchParams.get('brandId')

  const productWhere: Record<string, unknown> = { spaceId }
  if (brandId && brandId !== 'all') {
    productWhere.brandId = brandId === 'none' ? null : brandId
  }
  if (search) {
    productWhere.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
    ]
  }

  const products = await prisma.invProduct.findMany({
    where: productWhere,
    select: {
      id: true,
      name: true,
      code: true,
      brand: { select: { id: true, name: true } },
      options: { select: { id: true } },
      reorderConfig: true,
    },
    orderBy: { name: 'asc' },
  })

  if (products.length === 0) {
    return NextResponse.json({ data: [], windowDays: DEFAULT_WINDOW_DAYS })
  }

  const productIds = products.map((p) => p.id)
  const optionIds = products.flatMap((p) => p.options.map((o) => o.id))

  // 옵션 → 상품 역매핑
  const productByOption = new Map<string, string>()
  for (const p of products) {
    for (const o of p.options) productByOption.set(o.id, p.id)
  }

  // 현재 재고: 옵션별 집계 → 상품별 합산
  const stockGroups = optionIds.length
    ? await prisma.invStockLevel.groupBy({
        by: ['optionId'],
        where: { spaceId, optionId: { in: optionIds } },
        _sum: { quantity: true },
      })
    : []
  const stockByProduct = new Map<string, number>()
  for (const g of stockGroups) {
    const pid = productByOption.get(g.optionId)
    if (!pid) continue
    stockByProduct.set(pid, (stockByProduct.get(pid) ?? 0) + (g._sum.quantity ?? 0))
  }

  // 분석 기간별 버킷팅 — 대부분 기본값(90일)이라 1~2회 쿼리
  const windowBuckets = new Map<number, string[]>()
  for (const p of products) {
    const wd = p.reorderConfig?.analysisWindowDays ?? DEFAULT_WINDOW_DAYS
    const list = windowBuckets.get(wd) ?? []
    list.push(...p.options.map((o) => o.id))
    windowBuckets.set(wd, list)
  }

  const outboundByProduct = new Map<string, number>()
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
      const pid = productByOption.get(g.optionId)
      if (!pid) continue
      outboundByProduct.set(pid, (outboundByProduct.get(pid) ?? 0) + (g._sum.quantity ?? 0))
    }
  }

  const rows = products.map((p) => {
    const cfg = p.reorderConfig
    const windowDays = cfg?.analysisWindowDays ?? DEFAULT_WINDOW_DAYS
    const leadTimeDays = cfg?.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS
    const safetyStockQty = cfg?.safetyStockQty ?? DEFAULT_SAFETY_STOCK_QTY
    const currentStock = stockByProduct.get(p.id) ?? 0
    const totalOutbound = outboundByProduct.get(p.id) ?? 0

    const calc = calculateReorder({
      totalOutbound,
      windowDays,
      leadTimeDays,
      safetyStockQty,
      currentStock,
    })

    return {
      productId: p.id,
      productName: p.name,
      productCode: p.code,
      brandId: p.brand?.id ?? null,
      brandName: p.brand?.name ?? null,
      optionCount: p.options.length,
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

  let filtered = rows
  if (urgentOnly) filtered = filtered.filter((r) => r.isUrgent)
  if (reorderNeededOnly) filtered = filtered.filter((r) => r.reorderQty > 0)

  filtered.sort((a, b) => {
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

// 사용 가능 상품 ID — 사용처: products_used by productIds 체크. 상품 단위 이동 후엔 위 products 결과로 충분.
