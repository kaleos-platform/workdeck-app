/**
 * 옵션 단위 판매속도·소진예상일·보충/생산 판단 — MCP tool 전용 쿼리.
 *
 * 수요는 판매분석·발주 예측과 같은 loadOptionDemand 를 쓴다(세트→단품 팬아웃 완료된
 * GROSS 수량 — 기간별 취소/반품 데이터는 스키마에 없어 순판매 분리는 불가, missingFields 참조).
 * 로켓그로스 재고는 발주 계획과 같은 규칙으로 반품 등급 재고를 차감한다.
 *
 * 권장 수량은 단순 이동평균(velocity) 기반 추정치다 — 발주 플랜(예측모델·레이어드·반올림)과
 * 다를 수 있으며, 실제 발주 확정은 발주 플랜 경로를 쓴다.
 */

import { prisma } from '@/lib/prisma'
import { calculateReorder } from '@/lib/inv/reorder-calculator'
import { loadOptionDemand, type DemandChannel } from '@/lib/inv/option-demand'
import { getCoupangReturnStockByOption } from '@/lib/inv/coupang-return-stock'
import { sumIncomingProductionQtyByOption } from '@/lib/inv/planned-stock'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { addDaysYmd, lastClosedDateKst } from '@/lib/sh/sales-analytics'

const RESPONSE_BYTE_BUDGET = 50 * 1024

const DEFAULT_PERIOD_DAYS = 30
const DEFAULT_TARGET_COVER_DAYS = 30
const DEFAULT_LEAD_TIME_DAYS = 7

export type StatusThresholds = {
  outOfStockRiskDays: number
  replenishDays: number
  watchDays: number
}

export const DEFAULT_STATUS_THRESHOLDS: StatusThresholds = {
  outOfStockRiskDays: 7,
  replenishDays: 21,
  watchDays: 30,
}

export type ReplenishmentStatus = 'OUT_OF_STOCK_RISK' | 'REPLENISH' | 'WATCH' | 'OK' | 'NO_SALES'

/**
 * 기간별·옵션별 취소/반품/주문건수는 스키마에 없다(InventoryRecord.totalCancelled 는
 * 누적치, VENDOR 행에 주문건수 없음). 값을 지어내지 않고 부재를 알린다.
 * salesQty 는 GROSS(취소/반품 미차감) — 단, 로켓 VENDOR 판매량은 재수집 시
 * 정정 반영되는 값이라 사실상 순판매에 가깝다.
 */
const SCHEMA_MISSING_FIELDS = ['cancelQty', 'returnQty', 'netSalesQty', 'orderCount'] as const

export interface QueryOptionSalesVelocityParams {
  periodDays?: number | null
  productIds?: string[] | null
  optionIds?: string[] | null
  q?: string | null
  /** 채널 id 또는 이름. 미지정=로켓그로스 연동 채널, 'all'=전체 활성 채널. */
  channel?: string | null
  targetCoverDays?: number | null
  leadTimeDays?: number | null
  statusThresholds?: Partial<StatusThresholds> | null
  onlyNeedsReplenishment?: boolean | null
  includeInactive?: boolean | null
  page?: number | null
  pageSize?: number | null
  offset?: number | null
}

/** 로켓그로스 소진예상일 기준 4단계 판정 + 근거 문자열. */
export function judgeReplenishmentStatus(input: {
  rocketDailyVelocity: number
  rocketGrowthQty: number
  daysOfCoverRocketGrowth: number | null
  thresholds: StatusThresholds
}): { status: ReplenishmentStatus; reason: string } {
  const { rocketDailyVelocity, rocketGrowthQty, daysOfCoverRocketGrowth, thresholds } = input
  if (rocketDailyVelocity <= 0) {
    return { status: 'NO_SALES', reason: '기간 내 로켓그로스 판매 0 — 소진예상일 산정 불가' }
  }
  if (rocketGrowthQty <= 0 || daysOfCoverRocketGrowth == null) {
    return { status: 'OUT_OF_STOCK_RISK', reason: '판매 중인데 로켓그로스 가용재고 없음' }
  }
  if (daysOfCoverRocketGrowth < thresholds.outOfStockRiskDays) {
    return {
      status: 'OUT_OF_STOCK_RISK',
      reason: `로켓그로스 소진예상 ${daysOfCoverRocketGrowth}일 (<${thresholds.outOfStockRiskDays}일)`,
    }
  }
  if (daysOfCoverRocketGrowth < thresholds.replenishDays) {
    return {
      status: 'REPLENISH',
      reason: `로켓그로스 소진예상 ${daysOfCoverRocketGrowth}일 (<${thresholds.replenishDays}일)`,
    }
  }
  if (daysOfCoverRocketGrowth < thresholds.watchDays) {
    return {
      status: 'WATCH',
      reason: `로켓그로스 소진예상 ${daysOfCoverRocketGrowth}일 (<${thresholds.watchDays}일)`,
    }
  }
  return { status: 'OK', reason: `로켓그로스 소진예상 ${daysOfCoverRocketGrowth}일 (충분)` }
}

/**
 * 로켓그로스 목표 재고일수까지 채우는 이동(보충) 필요량.
 * 입고예정(생산)은 로켓 위치로 직접 입고되지 않으므로 여기서 빼지 않는다 —
 * 생산 필요량(suggestedProductionQty) 계산에서만 차감한다.
 */
export function suggestReplenishQty(input: {
  rocketDailyVelocityRaw: number
  targetCoverDays: number
  leadTimeDays: number
  safetyStockQty: number
  rocketGrowthQty: number
}): number {
  const need =
    input.rocketDailyVelocityRaw * (input.targetCoverDays + input.leadTimeDays) +
    input.safetyStockQty -
    input.rocketGrowthQty
  return need > 0 ? Math.ceil(need) : 0
}

/** 전사(로켓+3PL+사무실+입고예정) 재고가 총수요 대비 부족할 때의 생산 발주 필요량. */
export function suggestProductionQty(input: {
  totalDailyVelocityRaw: number
  targetCoverDays: number
  leadTimeDays: number
  safetyStockQty: number
  totalAvailableQty: number
  incomingQty: number
}): number {
  const need =
    input.totalDailyVelocityRaw * (input.targetCoverDays + input.leadTimeDays) +
    input.safetyStockQty -
    input.totalAvailableQty -
    input.incomingQty
  return need > 0 ? Math.ceil(need) : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function queryOptionSalesVelocity(
  spaceId: string,
  params: QueryOptionSalesVelocityParams = {}
) {
  const periodDays = Math.min(
    180,
    Math.max(7, Math.floor(params.periodDays ?? DEFAULT_PERIOD_DAYS))
  )
  const targetCoverDays = Math.max(
    0,
    Math.floor(params.targetCoverDays ?? DEFAULT_TARGET_COVER_DAYS)
  )
  const leadTimeDays = Math.max(0, Math.floor(params.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS))
  const thresholds: StatusThresholds = {
    ...DEFAULT_STATUS_THRESHOLDS,
    ...(params.statusThresholds ?? {}),
  }
  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(200, Math.max(1, Math.floor(params.pageSize ?? 50)))
  const offset =
    params.offset != null && params.offset >= 0 ? Math.floor(params.offset) : (page - 1) * pageSize
  const q = (params.q ?? '').trim().toLowerCase()

  // ── 기간: 마감일(어제, KST) 앵커. 직전 동일 길이 기간과 함께 1회 로드 후 분할.
  const to = lastClosedDateKst()
  const from = addDaysYmd(to, -(periodDays - 1))
  const prevTo = addDaysYmd(from, -1)
  const prevFrom = addDaysYmd(from, -periodDays)

  // ── 채널 해석
  const activeChannels: DemandChannel[] = await prisma.channel.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, name: true, externalSource: true },
  })
  const rocketChannels = activeChannels.filter(
    (c) => c.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH
  )
  const channelParam = (params.channel ?? '').trim()
  let selectedChannels: DemandChannel[]
  if (!channelParam) {
    selectedChannels = rocketChannels
  } else if (channelParam.toLowerCase() === 'all') {
    selectedChannels = activeChannels
  } else {
    selectedChannels = activeChannels.filter(
      (c) => c.id === channelParam || c.name.toLowerCase() === channelParam.toLowerCase()
    )
  }
  if (selectedChannels.length === 0) {
    const reason = channelParam
      ? `채널 '${channelParam}'을 찾을 수 없습니다 (활성 채널: ${activeChannels.map((c) => c.name).join(', ') || '없음'})`
      : '로켓그로스 연동 채널이 없습니다. channel 파라미터로 채널을 지정하세요.'
    return emptyResult({ from, to, periodDays, prevFrom, prevTo, page, pageSize, offset, reason })
  }

  // 로켓 지표는 선택 채널과 무관하게 항상 분리 제공 → 수요는 합집합으로 1회 로드.
  const demandChannelMap = new Map<string, DemandChannel>()
  for (const c of [...selectedChannels, ...rocketChannels]) demandChannelMap.set(c.id, c)
  const demandChannels = [...demandChannelMap.values()]
  const selectedChannelIds = new Set(selectedChannels.map((c) => c.id))
  const rocketChannelIds = new Set(rocketChannels.map((c) => c.id))

  const demandRows = await loadOptionDemand(
    spaceId,
    new Date(`${prevFrom}T00:00:00+09:00`),
    new Date(`${to}T23:59:59.999+09:00`),
    demandChannels
  )

  // ── 옵션 카탈로그 + 위치별 재고
  const optionWhere = {
    deletedAt: null,
    ...(params.optionIds?.length ? { id: { in: params.optionIds } } : {}),
    product: {
      spaceId,
      ...(params.productIds?.length ? { id: { in: params.productIds } } : {}),
      ...(params.includeInactive ? {} : { status: 'ACTIVE' as const }),
    },
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { sku: { contains: q, mode: 'insensitive' as const } },
            { product: { name: { contains: q, mode: 'insensitive' as const } } },
            { product: { internalName: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  }

  const [options, locations] = await Promise.all([
    prisma.invProductOption.findMany({
      where: optionWhere,
      select: {
        id: true,
        name: true,
        sku: true,
        safetyStockQty: true,
        product: { select: { id: true, name: true, internalName: true } },
        stockLevels: { select: { locationId: true, quantity: true } },
      },
    }),
    prisma.invStorageLocation.findMany({
      where: { spaceId },
      select: { id: true, type: true, externalSource: true },
    }),
  ])

  const locationKind = new Map<string, 'rocket' | 'thirdParty' | 'office'>()
  for (const l of locations) {
    locationKind.set(
      l.id,
      l.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH
        ? 'rocket'
        : l.type === 'THIRD_PARTY'
          ? 'thirdParty'
          : 'office'
    )
  }

  const optionIds = options.map((o) => o.id)
  const optionIdSet = new Set(optionIds)

  // ── 반품 등급 재고(발주 계획과 동일 규칙: 로켓 가용에서 제외) + 입고예정
  const [returnStock, pendingRuns] = await Promise.all([
    getCoupangReturnStockByOption(spaceId),
    optionIds.length
      ? prisma.productionRun.findMany({
          where: { spaceId, status: 'ORDERED', items: { some: { optionId: { in: optionIds } } } },
          select: {
            status: true,
            items: {
              where: { optionId: { in: optionIds } },
              select: { optionId: true, quantity: true },
            },
          },
        })
      : Promise.resolve([]),
  ])
  const incomingByOption = sumIncomingProductionQtyByOption(pendingRuns)

  // ── 수요 분할: (현재|직전) × (선택 채널|로켓)
  const salesByOption = new Map<string, number>()
  const prevSalesByOption = new Map<string, number>()
  const rocketSalesByOption = new Map<string, number>()
  for (const row of demandRows) {
    if (!optionIdSet.has(row.optionId)) continue
    const isCurrent = row.date >= from && row.date <= to
    const isPrev = row.date >= prevFrom && row.date <= prevTo
    if (selectedChannelIds.has(row.channelId)) {
      if (isCurrent)
        salesByOption.set(row.optionId, (salesByOption.get(row.optionId) ?? 0) + row.quantity)
      if (isPrev)
        prevSalesByOption.set(
          row.optionId,
          (prevSalesByOption.get(row.optionId) ?? 0) + row.quantity
        )
    }
    if (isCurrent && rocketChannelIds.has(row.channelId)) {
      rocketSalesByOption.set(
        row.optionId,
        (rocketSalesByOption.get(row.optionId) ?? 0) + row.quantity
      )
    }
  }

  // ── 옵션별 계산
  const builtRows = options.map((o) => {
    let rocketRaw = 0
    let thirdPartyQty = 0
    let officeQty = 0
    for (const sl of o.stockLevels) {
      const kind = locationKind.get(sl.locationId) ?? 'office'
      if (kind === 'rocket') rocketRaw += sl.quantity
      else if (kind === 'thirdParty') thirdPartyQty += sl.quantity
      else officeQty += sl.quantity
    }
    const returnGradeQty = returnStock?.byOption.get(o.id) ?? 0
    // 스냅샷 시점 차이로 반품량이 현재고를 넘을 수 있다 — 음수 재고를 만들지 않는다.
    const rocketGrowthQty = Math.max(0, rocketRaw - returnGradeQty)
    const totalAvailableQty = rocketGrowthQty + thirdPartyQty + officeQty
    const incomingQty = incomingByOption.get(o.id) ?? 0
    const safetyStockQty = o.safetyStockQty

    const salesQty = salesByOption.get(o.id) ?? 0
    const prevSalesQty = prevSalesByOption.get(o.id) ?? 0
    const rocketSalesQty = rocketSalesByOption.get(o.id) ?? 0

    // 로켓 velocity·소진일은 발주 목록과 같은 calculateReorder 로 산출(반올림 규칙 정합).
    const rocketCalc = calculateReorder({
      totalOutbound: rocketSalesQty,
      windowDays: periodDays,
      leadTimeDays,
      safetyStockQty,
      currentStock: rocketGrowthQty,
    })
    const totalCalc = calculateReorder({
      totalOutbound: salesQty,
      windowDays: periodDays,
      leadTimeDays,
      safetyStockQty,
      currentStock: totalAvailableQty,
    })

    const suggestedReplenishQty = suggestReplenishQty({
      rocketDailyVelocityRaw: rocketSalesQty / periodDays,
      targetCoverDays,
      leadTimeDays,
      safetyStockQty,
      rocketGrowthQty,
    })
    const replenishmentSourceAvailableQty = thirdPartyQty + officeQty
    const cappedReplenishQty = Math.min(suggestedReplenishQty, replenishmentSourceAvailableQty)
    const suggestedProductionQty = suggestProductionQty({
      totalDailyVelocityRaw: salesQty / periodDays,
      targetCoverDays,
      leadTimeDays,
      safetyStockQty,
      totalAvailableQty,
      incomingQty,
    })

    const { status, reason } = judgeReplenishmentStatus({
      rocketDailyVelocity: rocketCalc.dailyAvgOutbound,
      rocketGrowthQty,
      daysOfCoverRocketGrowth: rocketCalc.estimatedDepletionDays,
      thresholds,
    })

    const productName =
      o.product.internalName && o.product.internalName.trim().length > 0
        ? o.product.internalName
        : o.product.name

    return {
      productId: o.product.id,
      productName,
      optionId: o.id,
      optionName: o.name,
      skuCode: o.sku,
      // 판매 (GROSS)
      salesQty,
      rocketSalesQty,
      dailyVelocity: round2(salesQty / periodDays),
      rocketDailyVelocity: rocketCalc.dailyAvgOutbound,
      prevSalesQty,
      velocityChangePct:
        prevSalesQty > 0 ? round2(((salesQty - prevSalesQty) / prevSalesQty) * 100) : null,
      // 재고
      rocketGrowthQty,
      returnGradeQty,
      thirdPartyQty,
      officeQty,
      totalAvailableQty,
      incomingQty,
      safetyStockQty,
      // 소진·보충·생산
      daysOfCoverRocketGrowth: rocketCalc.estimatedDepletionDays,
      daysOfCoverTotal: totalCalc.estimatedDepletionDays,
      suggestedReplenishQty,
      replenishmentSourceAvailableQty,
      cappedReplenishQty,
      suggestedProductionQty,
      replenishmentStatus: status,
      statusReason: reason,
    }
  })

  // 판매·재고 모두 0인 옵션은 판단 대상이 아니다 — 노이즈 제거.
  let filtered = builtRows.filter(
    (r) => r.salesQty > 0 || r.prevSalesQty > 0 || r.totalAvailableQty > 0 || r.incomingQty > 0
  )
  if (params.onlyNeedsReplenishment) {
    filtered = filtered.filter(
      (r) => r.replenishmentStatus === 'OUT_OF_STOCK_RISK' || r.replenishmentStatus === 'REPLENISH'
    )
  }

  // 급한 순: 재고 0인데 팔리는 옵션(cover null + OUT_OF_STOCK_RISK) 최상단, 이후 cover asc, 판매 0 은 뒤.
  const sortKey = (r: (typeof filtered)[number]) =>
    r.replenishmentStatus === 'OUT_OF_STOCK_RISK' && r.daysOfCoverRocketGrowth == null
      ? -1
      : (r.daysOfCoverRocketGrowth ?? Number.POSITIVE_INFINITY)
  filtered.sort((a, b) => sortKey(a) - sortKey(b) || b.salesQty - a.salesQty)

  const total = filtered.length
  const statusCounts: Record<ReplenishmentStatus, number> = {
    OUT_OF_STOCK_RISK: 0,
    REPLENISH: 0,
    WATCH: 0,
    OK: 0,
    NO_SALES: 0,
  }
  for (const r of filtered) statusCounts[r.replenishmentStatus] += 1

  let rows = filtered.slice(offset, offset + pageSize)
  let truncatedForSize = false
  while (
    rows.length > 1 &&
    Buffer.byteLength(JSON.stringify(rows), 'utf8') > RESPONSE_BYTE_BUDGET
  ) {
    rows = rows.slice(0, -1)
    truncatedForSize = true
  }
  const consumed = offset + rows.length
  const nextCursor = consumed < total ? String(consumed) : null

  const summary = {
    period: { from, to, days: periodDays },
    prevPeriod: { from: prevFrom, to: prevTo },
    lastClosedDate: to,
    channels: selectedChannels.map((c) => c.name),
    targetCoverDays,
    leadTimeDays,
    statusThresholds: thresholds,
    returnStockSnapshotDate: returnStock?.snapshotDate.toISOString() ?? null,
    total,
    statusCounts,
    totalSuggestedReplenishQty: filtered.reduce((s, r) => s + r.suggestedReplenishQty, 0),
    totalSuggestedProductionQty: filtered.reduce((s, r) => s + r.suggestedProductionQty, 0),
    // 3PL+사무실 재고로 권장 보충을 다 못 채우는 SKU 수 — 생산/입고 없이는 이동 불가.
    replenishShortfallSkuCount: filtered.filter(
      (r) => r.cappedReplenishQty < r.suggestedReplenishQty
    ).length,
    truncatedForSize,
    returned: rows.length,
  }

  return {
    summary,
    rows,
    page,
    pageSize,
    offset,
    total,
    nextCursor,
    missingFields: [...SCHEMA_MISSING_FIELDS],
  }
}

function emptyResult(input: {
  from: string
  to: string
  periodDays: number
  prevFrom: string
  prevTo: string
  page: number
  pageSize: number
  offset: number
  reason: string
}) {
  return {
    summary: {
      period: { from: input.from, to: input.to, days: input.periodDays },
      prevPeriod: { from: input.prevFrom, to: input.prevTo },
      lastClosedDate: input.to,
      channels: [] as string[],
      total: 0,
      statusCounts: { OUT_OF_STOCK_RISK: 0, REPLENISH: 0, WATCH: 0, OK: 0, NO_SALES: 0 },
      truncatedForSize: false,
      returned: 0,
      reason: input.reason,
    },
    rows: [],
    page: input.page,
    pageSize: input.pageSize,
    offset: input.offset,
    total: 0,
    nextCursor: null,
    missingFields: [...SCHEMA_MISSING_FIELDS],
  }
}
