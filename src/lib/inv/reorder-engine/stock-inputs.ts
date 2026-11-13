import { prisma } from '@/lib/prisma'
import { getCoupangReturnStockByOption } from '@/lib/inv/coupang-return-stock'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import {
  INCOMING_PRODUCTION_STATUSES,
  sumIncomingProductionQtyByOption,
} from '@/lib/inv/planned-stock'

/** 외부 입고분을 "생산 중"으로 보는 최대 기간(일) */
const EXTERNAL_PENDING_MAX_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export function isExternalLogisticsLocation(loc: {
  type: string
  externalSource: string | null
}): boolean {
  return loc.type === 'THIRD_PARTY' || loc.externalSource != null
}

type ExternalStockIn = { optionId: string; locationId: string; quantity: number }

function parseExternalStockIns(raw: unknown): ExternalStockIn[] {
  if (!Array.isArray(raw)) return []
  const out: ExternalStockIn[] = []
  for (const e of raw) {
    if (e == null || typeof e !== 'object') continue
    const { optionId, locationId, quantity } = e as Record<string, unknown>
    if (typeof optionId !== 'string' || typeof locationId !== 'string') continue
    if (typeof quantity !== 'number' || !Number.isFinite(quantity)) continue
    out.push({ optionId, locationId, quantity })
  }
  return out
}

/**
 * 외부 물류 위치로 입고됐지만 아직 그 위치 재고에 반영되지 않은(확정 대조 전) 수량.
 * 위치의 확정 대조가 stockedInAt 이후면 이미 재고에 반영된 것으로 보고 제외한다.
 */
export function pendingExternalQtyByOption(
  runs: Array<{ stockedInAt: Date | null; externalStockIns: unknown }>,
  lastConfirmedReconAtByLocation: Map<string, Date>,
  now: Date
): Map<string, number> {
  const cutoff = now.getTime() - EXTERNAL_PENDING_MAX_DAYS * DAY_MS
  const result = new Map<string, number>()
  for (const run of runs) {
    if (!run.stockedInAt || run.stockedInAt.getTime() < cutoff) continue
    for (const e of parseExternalStockIns(run.externalStockIns)) {
      const reconAt = lastConfirmedReconAtByLocation.get(e.locationId)
      if (reconAt && reconAt.getTime() > run.stockedInAt.getTime()) continue
      result.set(e.optionId, (result.get(e.optionId) ?? 0) + e.quantity)
    }
  }
  return result
}

export type ReorderStockInput = {
  onHandQty: number
  rocketOnHandQty: number
  incomingQty: number
  /** 연동 위치로 들어올 예정 수량(계획 차수 입고 위치 + 외부 입고 대기분). incomingQty 에 포함된 일부 */
  rocketIncomingQty: number
  returnGradeQty: number
}

/**
 * linkedLocationIds = 연동(레이어드) 위치. 미지정이면 쿠팡 로켓그로스 위치.
 * rocketOnHandQty·rocketIncomingQty 는 이 위치들 기준이다.
 */
export async function loadReorderStockInputs(
  spaceId: string,
  optionIds: string[],
  now: Date = new Date(),
  linkedLocationIds?: string[]
): Promise<Map<string, ReorderStockInput>> {
  const result = new Map<string, ReorderStockInput>()
  if (optionIds.length === 0) return result

  const [levels, locations, returnStock, runs, recons] = await Promise.all([
    prisma.invStockLevel.groupBy({
      by: ['optionId', 'locationId'],
      where: { spaceId, optionId: { in: optionIds } },
      _sum: { quantity: true },
    }),
    prisma.invStorageLocation.findMany({
      where: { spaceId },
      select: { id: true, type: true, externalSource: true },
    }),
    getCoupangReturnStockByOption(spaceId),
    prisma.productionRun.findMany({
      where: {
        spaceId,
        OR: [
          { status: { in: [...INCOMING_PRODUCTION_STATUSES] } },
          { stockedInAt: { gte: new Date(now.getTime() - EXTERNAL_PENDING_MAX_DAYS * DAY_MS) } },
        ],
      },
      select: {
        status: true,
        stockInLocationId: true,
        stockedInAt: true,
        externalStockIns: true,
        items: {
          where: { optionId: { in: optionIds } },
          select: { optionId: true, quantity: true },
        },
      },
    }),
    prisma.invReconciliation.findMany({
      where: { spaceId, status: { in: ['CONFIRMED', 'APPLIED'] } },
      select: { locationId: true, confirmedAt: true, createdAt: true },
    }),
  ])

  const rocketLocationIds = new Set(
    linkedLocationIds ??
      locations
        .filter((l) => l.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH)
        .map((l) => l.id)
  )

  const totalByOption = new Map<string, number>()
  const rocketByOption = new Map<string, number>()
  for (const g of levels) {
    const q = g._sum.quantity ?? 0
    totalByOption.set(g.optionId, (totalByOption.get(g.optionId) ?? 0) + q)
    if (rocketLocationIds.has(g.locationId)) {
      rocketByOption.set(g.optionId, (rocketByOption.get(g.optionId) ?? 0) + q)
    }
  }

  const lastReconAt = new Map<string, Date>()
  for (const r of recons) {
    const at = r.confirmedAt ?? r.createdAt
    const prev = lastReconAt.get(r.locationId)
    if (!prev || at > prev) lastReconAt.set(r.locationId, at)
  }

  const externalLocationIds = new Set(
    locations.filter(isExternalLogisticsLocation).map((l) => l.id)
  )
  // 외부 물류 위치로 간 입고분만 대기분 대상
  const optionIdSet = new Set(optionIds)
  const pendingRuns = runs.map((r) => ({
    stockedInAt: r.stockedInAt,
    externalStockIns: parseExternalStockIns(r.externalStockIns).filter(
      (e) => externalLocationIds.has(e.locationId) && optionIdSet.has(e.optionId)
    ),
  }))
  const pendingExternal = pendingExternalQtyByOption(pendingRuns, lastReconAt, now)
  const incomingRuns = sumIncomingProductionQtyByOption(runs)
  // 연동 위치분 — 그 위치로 입고될 계획 차수 + 그 위치로 들어간 외부 대기분
  const rocketPending = pendingExternalQtyByOption(
    pendingRuns.map((r) => ({
      stockedInAt: r.stockedInAt,
      externalStockIns: r.externalStockIns.filter((e) => rocketLocationIds.has(e.locationId)),
    })),
    lastReconAt,
    now
  )
  const rocketIncomingRuns = sumIncomingProductionQtyByOption(
    runs.filter((r) => r.stockInLocationId != null && rocketLocationIds.has(r.stockInLocationId))
  )

  for (const optionId of optionIds) {
    // 반품 등급은 로켓그로스 위치에만 있다. 스냅샷 시점 차이로 현재고를 넘으면 0 으로 바닥.
    const returnQty = Math.max(0, returnStock?.byOption.get(optionId) ?? 0)
    const total = totalByOption.get(optionId) ?? 0
    const rocket = rocketByOption.get(optionId) ?? 0
    result.set(optionId, {
      // 음수도 그대로 둔다 — computeOrderQty 가 checkStock 으로 처리한다.
      onHandQty: total - returnQty,
      rocketOnHandQty:
        returnQty > 0 && rocketByOption.has(optionId) ? Math.max(0, rocket - returnQty) : rocket,
      incomingQty: (incomingRuns.get(optionId) ?? 0) + (pendingExternal.get(optionId) ?? 0),
      rocketIncomingQty:
        (rocketIncomingRuns.get(optionId) ?? 0) + (rocketPending.get(optionId) ?? 0),
      returnGradeQty: returnQty,
    })
  }
  return result
}
