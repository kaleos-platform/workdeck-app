import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { calculateReorder } from '@/lib/inv/reorder-calculator'

const DEFAULT_WINDOW_DAYS = 90
const DEFAULT_LEAD_TIME_DAYS = 7
const DEFAULT_SAFETY_STOCK_QTY = 0

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { searchParams } = req.nextUrl
  const urgentOnly = searchParams.get('urgentOnly') === 'true'
  const reorderNeededOnly = searchParams.get('reorderNeededOnly') === 'true'

  // 1. space 내 모든 상품 옵션 조회 (+ 상품 정보)
  const options = await prisma.invProductOption.findMany({
    where: { product: { spaceId } },
    select: {
      id: true,
      name: true,
      sku: true,
      product: { select: { id: true, name: true, code: true } },
    },
    orderBy: [{ product: { name: 'asc' } }, { name: 'asc' }],
  })

  if (options.length === 0) {
    return NextResponse.json({ data: [], windowDays: DEFAULT_WINDOW_DAYS })
  }

  const optionIds = options.map((o) => o.id)

  // 2. 옵션별 reorder 설정 일괄 조회
  const configs = await prisma.invReorderConfig.findMany({
    where: { optionId: { in: optionIds } },
  })
  const configByOption = new Map(configs.map((c) => [c.optionId, c]))

  // 3. 현재 재고 일괄 집계 (옵션 × 장소 합산)
  const stockGroups = await prisma.invStockLevel.groupBy({
    by: ['optionId'],
    where: { spaceId, optionId: { in: optionIds } },
    _sum: { quantity: true },
  })
  const stockByOption = new Map(
    stockGroups.map((g) => [g.optionId, g._sum.quantity ?? 0]),
  )

  // 4. 분석 기간은 옵션별로 다를 수 있으므로 "설정 windowDays 별"로 출고 집계
  // 대부분 옵션이 기본값을 공유하므로 windowDays를 기준으로 그룹핑해 2~3회 쿼리로 해결
  const windowBuckets = new Map<number, string[]>()
  for (const opt of options) {
    const cfg = configByOption.get(opt.id)
    const wd = cfg?.analysisWindowDays ?? DEFAULT_WINDOW_DAYS
    const list = windowBuckets.get(wd) ?? []
    list.push(opt.id)
    windowBuckets.set(wd, list)
  }

  const outboundByOption = new Map<string, number>()
  const now = Date.now()
  for (const [wd, ids] of windowBuckets.entries()) {
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

  // 5. 옵션별 reorder 계산
  const rows = options.map((opt) => {
    const cfg = configByOption.get(opt.id)
    const windowDays = cfg?.analysisWindowDays ?? DEFAULT_WINDOW_DAYS
    const leadTimeDays = cfg?.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS
    const safetyStockQty = cfg?.safetyStockQty ?? DEFAULT_SAFETY_STOCK_QTY
    const currentStock = stockByOption.get(opt.id) ?? 0
    const totalOutbound = outboundByOption.get(opt.id) ?? 0

    const calc = calculateReorder({
      totalOutbound,
      windowDays,
      leadTimeDays,
      safetyStockQty,
      currentStock,
    })

    return {
      optionId: opt.id,
      productId: opt.product.id,
      productName: opt.product.name,
      productCode: opt.product.code,
      optionName: opt.name,
      optionSku: opt.sku,
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
    }
  })

  // 6. 필터
  let filtered = rows
  if (urgentOnly) filtered = filtered.filter((r) => r.isUrgent)
  if (reorderNeededOnly) filtered = filtered.filter((r) => r.reorderQty > 0)

  // 7. 정렬: reorderQty DESC → estimatedDepletionDays ASC (null은 마지막)
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
