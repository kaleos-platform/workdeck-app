import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { calculateReorder } from '@/lib/inv/reorder-calculator'
import { loadOptionDemand } from '@/lib/inv/option-demand'
import { plannedStockQty, sumIncomingProductionQtyByOption } from '@/lib/inv/planned-stock'
import { formatDateToYmdKst } from '@/lib/date-range'

// KST 기준 YYYY-MM-DD — loadOptionDemand의 toKstDateKey 키와 타임존 일치.
// Vercel(UTC) 서버에서 로컬 getter(getFullYear 등)를 쓰면 KST 자정~09시에 전날로 계산되므로 KST 변환 필수.
const toDateStr = formatDateToYmdKst

const DEFAULT_WINDOW_DAYS = 90
const DEFAULT_LEAD_TIME_DAYS = 7

/**
 * 발주 예측 — 옵션 단위 행.
 * - 계산은 옵션 단위(재고/출고)로 수행.
 * - 안전재고는 옵션 단위(`InvProductOption.safetyStockQty`)에서 읽는다 — 단일 진입점.
 * - 리드타임/분석기간은 상품 단위 config(`InvReorderConfig`)를 공유.
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
      reorderRoundUnit: true,
      brand: { select: { id: true, name: true } },
      options: {
        where: { deletedAt: null },
        select: { id: true, name: true, sku: true, safetyStockQty: true },
      },
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

  const pendingRuns = optionIds.length
    ? await prisma.productionRun.findMany({
        where: {
          spaceId,
          status: 'ORDERED',
          items: { some: { optionId: { in: optionIds } } },
        },
        select: {
          status: true,
          items: {
            where: { optionId: { in: optionIds } },
            select: { optionId: true, quantity: true },
          },
        },
      })
    : []
  const incomingByOption = sumIncomingProductionQtyByOption(pendingRuns)

  // 수요 신호 = 옵션별 주문수요 합(수동채널 DelOrderItem + 로켓 VENDOR). 발주 plan 생성과
  // 판매분석이 공유하는 loadOptionDemand 를 써 세 화면이 정의상 같은 수요를 본다.
  // (OUTBOUND 장부 대신 주문수요 — OUTBOUND 는 재고차감·정확도 baseline 전용.)
  const windowDaysByOption = new Map<string, number>()
  for (const p of products) {
    const wd = p.reorderConfig?.analysisWindowDays ?? DEFAULT_WINDOW_DAYS
    for (const o of p.options) windowDaysByOption.set(o.id, wd)
  }

  const outboundByOption = new Map<string, number>()
  if (optionIds.length > 0) {
    const now = new Date()
    const maxWindowDays = Math.max(DEFAULT_WINDOW_DAYS, ...windowDaysByOption.values())
    const since = new Date(now.getTime() - maxWindowDays * 24 * 60 * 60 * 1000)
    const optionIdSet = new Set(optionIds)

    const activeChannels = await prisma.channel.findMany({
      where: { spaceId, isActive: true },
      select: { id: true, name: true, externalSource: true },
    })

    const demandRows = await loadOptionDemand(spaceId, since, now, activeChannels)

    // 옵션별 일별 수요 → windowDays 절단 합산 (옵션마다 분석기간 다를 수 있음).
    const dailyByOption = new Map<string, Record<string, number>>()
    for (const id of optionIds) dailyByOption.set(id, {})
    for (const row of demandRows) {
      if (!optionIdSet.has(row.optionId)) continue
      const byDate = dailyByOption.get(row.optionId)!
      byDate[row.date] = (byDate[row.date] ?? 0) + row.quantity
    }
    for (const id of optionIds) {
      const wd = windowDaysByOption.get(id) ?? DEFAULT_WINDOW_DAYS
      const cutoff = toDateStr(new Date(now.getTime() - (wd - 1) * 24 * 60 * 60 * 1000))
      const byDate = dailyByOption.get(id) ?? {}
      let sum = 0
      for (const [date, qty] of Object.entries(byDate)) {
        if (date >= cutoff) sum += qty
      }
      outboundByOption.set(id, sum)
    }
  }

  // 옵션 단위 행 생성
  const rows = products.flatMap((p) => {
    const cfg = p.reorderConfig
    const windowDays = cfg?.analysisWindowDays ?? DEFAULT_WINDOW_DAYS
    const leadTimeDays = cfg?.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS

    const displayName = p.internalName && p.internalName.trim().length > 0 ? p.internalName : p.name
    return p.options.map((o) => {
      const onHandStock = stockByOption.get(o.id) ?? 0
      const incomingQty = incomingByOption.get(o.id) ?? 0
      const currentStock = plannedStockQty({ onHandQty: onHandStock, incomingQty })
      const totalOutbound = outboundByOption.get(o.id) ?? 0
      const safetyStockQty = o.safetyStockQty
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
        onHandStock,
        incomingQty,
        totalOutbound,
        windowDays,
        dailyAvgOutbound: calc.dailyAvgOutbound,
        leadTimeDays,
        reorderRoundUnit: p.reorderRoundUnit,
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
