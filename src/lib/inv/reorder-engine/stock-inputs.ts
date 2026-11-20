import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import {
  loadLastReconAt,
  parseStockInAllocations,
  reconciledAfter,
  stockInRefId,
} from '@/lib/sh/production-stock-in'
import { isExternalLogisticsLocation } from '@/lib/inv/location-kind'
import { getCoupangReturnStockByOption } from '@/lib/inv/coupang-return-stock'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import {
  INCOMING_PRODUCTION_STATUSES,
  sumIncomingProductionQtyByOption,
} from '@/lib/inv/planned-stock'

/** 외부 입고분을 "생산 중"으로 보는 최대 기간(일) */
const EXTERNAL_PENDING_MAX_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export { isExternalLogisticsLocation }

/**
 * 입고 완료 차수의 위치 분배(연동·외부·자체 전부) 중 아직 그 위치 재고에 반영되지 않은 수량.
 * 해소 조건(먼저 오는 것): ① 그 차수·옵션·위치 INBOUND 등록(수량 무관), ② stockedInAt 이후 그 위치
 * 대조 반영(자체 위치는 KST 날짜가 더 늦을 때만), ③ EXTERNAL_PENDING_MAX_DAYS 경과.
 */
export function pendingExternalQtyByOption(
  runs: Array<{ id?: string; stockedInAt: Date | null; externalStockIns: unknown }>,
  lastReconAtByLocation: Map<string, Date>,
  now: Date,
  registeredRefs: Set<string> = new Set(),
  ownLocationIds: Set<string> = new Set()
): Map<string, number> {
  const cutoff = now.getTime() - EXTERNAL_PENDING_MAX_DAYS * DAY_MS
  const result = new Map<string, number>()
  for (const run of runs) {
    if (!run.stockedInAt || run.stockedInAt.getTime() < cutoff) continue
    for (const e of parseStockInAllocations(run.externalStockIns)) {
      if (run.id && registeredRefs.has(stockInRefId(run.id, e.optionId, e.locationId))) continue
      const reconAt = lastReconAtByLocation.get(e.locationId)
      if (reconciledAfter(reconAt, run.stockedInAt, ownLocationIds.has(e.locationId))) continue
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

  const cutoffDate = new Date(now.getTime() - EXTERNAL_PENDING_MAX_DAYS * DAY_MS)
  const optionIdSet = new Set(optionIds)
  // 재고 수준·차수·입고 등록·대조를 같은 RepeatableRead 스냅샷에서 읽는다 — 읽는 사이 입고 등록/대조가
  // 끼어 현재고는 증가 전, 입고 예정은 해소 후로 보이는(과소 발주) 불일치를 막는다.
  // 입고 등록(INBOUND)은 차수를 읽은 뒤 정확한 referenceId 로 조회해야 해서 interactive tx 를 쓴다.
  const [snapshot, returnStock] = await Promise.all([
    prisma.$transaction(
      async (tx) => {
        const levels = await tx.invStockLevel.groupBy({
          by: ['optionId', 'locationId'],
          orderBy: { optionId: 'asc' },
          where: { spaceId, optionId: { in: optionIds } },
          _sum: { quantity: true },
        })
        const locations = await tx.invStorageLocation.findMany({
          where: { spaceId },
          select: { id: true, type: true, externalSource: true },
        })
        const runs = await tx.productionRun.findMany({
          where: {
            spaceId,
            OR: [
              { status: { in: [...INCOMING_PRODUCTION_STATUSES] } },
              { stockedInAt: { gte: cutoffDate } },
            ],
          },
          select: {
            id: true,
            status: true,
            stockInLocationId: true,
            stockedInAt: true,
            externalStockIns: true,
            items: {
              where: { optionId: { in: optionIds } },
              select: { optionId: true, quantity: true },
            },
          },
        })
        // 대기 대상 분배의 INBOUND 등록 여부 — 정확한 키로만 조회
        const refs = runs.flatMap((r) =>
          r.stockedInAt
            ? parseStockInAllocations(r.externalStockIns)
                .filter((e) => optionIdSet.has(e.optionId))
                .map((e) => stockInRefId(r.id, e.optionId, e.locationId))
            : []
        )
        const movements =
          refs.length > 0
            ? await tx.invMovement.findMany({
                where: { spaceId, type: 'INBOUND', referenceId: { in: refs } },
                select: { referenceId: true },
              })
            : []
        const lastReconAt = await loadLastReconAt(tx, spaceId, { since: cutoffDate })
        return { levels, locations, runs, movements, lastReconAt }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 10_000,
        timeout: 30_000,
      }
    ),
    getCoupangReturnStockByOption(spaceId),
  ])
  const { levels, locations, runs, movements, lastReconAt } = snapshot
  const registeredRefs = new Set(
    movements.map((m) => m.referenceId).filter((r): r is string => r != null)
  )

  const rocketLocationIds = new Set(
    linkedLocationIds ??
      locations
        .filter((l) => l.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH)
        .map((l) => l.id)
  )

  const totalByOption = new Map<string, number>()
  const rocketByOption = new Map<string, number>()
  for (const g of levels) {
    const q = g._sum?.quantity ?? 0
    totalByOption.set(g.optionId, (totalByOption.get(g.optionId) ?? 0) + q)
    if (rocketLocationIds.has(g.locationId)) {
      rocketByOption.set(g.optionId, (rocketByOption.get(g.optionId) ?? 0) + q)
    }
  }

  // 모든 분배(외부·자체)가 대상이다. stockedInAt 은 날짜(UTC 00:00 = KST 09:00)라, 같은 날 그 이후에
  // 확정된 대조는 대기분을 비운다 — 대조가 이미 입고를 재고에 반영했다고 보는 의도된 동작(11-12 사고 정합).
  const ownLocationIds = new Set(
    locations.filter((l) => !isExternalLogisticsLocation(l)).map((l) => l.id)
  )
  const pendingRuns = runs.map((r) => ({
    id: r.id,
    stockedInAt: r.stockedInAt,
    externalStockIns: parseStockInAllocations(r.externalStockIns).filter((e) =>
      optionIdSet.has(e.optionId)
    ),
  }))
  const pendingExternal = pendingExternalQtyByOption(
    pendingRuns,
    lastReconAt,
    now,
    registeredRefs,
    ownLocationIds
  )
  const incomingRuns = sumIncomingProductionQtyByOption(runs)
  // 연동 위치분 — 그 위치로 입고될 계획 차수 + 그 위치로 들어간 외부 대기분
  const rocketPending = pendingExternalQtyByOption(
    pendingRuns.map((r) => ({
      id: r.id,
      stockedInAt: r.stockedInAt,
      externalStockIns: r.externalStockIns.filter((e) => rocketLocationIds.has(e.locationId)),
    })),
    lastReconAt,
    now,
    registeredRefs,
    ownLocationIds
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
      // 연동 위치 재고는 반품 등급을 뺀 뒤에도, 반품 등급이 없어도 0 미만으로 내려가지 않게 바닥 처리
      rocketOnHandQty: Math.max(
        0,
        returnQty > 0 && rocketByOption.has(optionId) ? rocket - returnQty : rocket
      ),
      incomingQty: (incomingRuns.get(optionId) ?? 0) + (pendingExternal.get(optionId) ?? 0),
      rocketIncomingQty:
        (rocketIncomingRuns.get(optionId) ?? 0) + (rocketPending.get(optionId) ?? 0),
      returnGradeQty: returnQty,
    })
  }
  return result
}
