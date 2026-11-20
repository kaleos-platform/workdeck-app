import { Prisma } from '@/generated/prisma/client'
import { isExternalLogisticsLocation } from '@/lib/inv/location-kind'

// 생산 차수 입고 완료(STOCKED_IN)와 재고 입고(InvMovement INBOUND)의 분리 — 공용 판정·조회.
//
// ProductionRun.externalStockIns(Json) 는 레거시 컬럼명이지만 이제 **모든 위치 분배**
// (연동·3PL 외부 + 사무실 등 자체)를 [{ optionId, locationId, quantity }] 로 담는다.
// 재고 증감은 INBOUND 건(referenceId = prodrun:<runId>:<optionId>:<locationId>)으로만 일어난다.

export type StockInAllocation = { optionId: string; locationId: string; quantity: number }

export function parseStockInAllocations(raw: unknown): StockInAllocation[] {
  if (!Array.isArray(raw)) return []
  const out: StockInAllocation[] = []
  for (const e of raw) {
    if (e == null || typeof e !== 'object') continue
    const { optionId, locationId, quantity } = e as Record<string, unknown>
    if (typeof optionId !== 'string' || typeof locationId !== 'string') continue
    if (typeof quantity !== 'number' || !Number.isFinite(quantity)) continue
    out.push({ optionId, locationId, quantity })
  }
  return out
}

export const stockInRefId = (runId: string, optionId: string, locationId: string) =>
  `prodrun:${runId}:${optionId}:${locationId}`

type ReadDb = Pick<
  Prisma.TransactionClient,
  'invMovement' | 'invReconciliation' | 'invStorageLocation'
>

type RunLite = { id: string; stockedInAt: Date | null; externalStockIns: unknown }

export type StockInFacts = {
  /** referenceId → 등록된 INBOUND(수량·입고일) */
  registered: Map<string, { quantity: number; movementDate: Date }>
  /** 위치 → 재고 대조가 재고에 반영된 마지막 시각 (확정 대조 + 대조 ADJUSTMENT) */
  lastReconAtByLocation: Map<string, Date>
  /** 분배 위치 중 자체(비외부) 위치 — 같은 날짜 대조 규칙(KST 날짜 비교) 적용 대상 */
  ownLocationIds: Set<string>
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const ymd = (d: Date) => d.toISOString().slice(0, 10)

/**
 * "재고 대조가 입고 이후에 반영됐는가".
 * 외부 위치: 대조 시각 > stockedInAt. 자체 위치: stockedInAt 은 날짜(UTC 00:00)라 같은 날 실사가 등록을
 * 영구히 막지 않도록 대조의 KST 달력 날짜가 stockedInAt 날짜보다 엄격히 늦을 때만.
 */
export function reconciledAfter(
  lastReconAt: Date | undefined,
  stockedInAt: Date | null,
  isOwn: boolean
): boolean {
  if (!lastReconAt || !stockedInAt) return false
  if (!isOwn) return lastReconAt.getTime() > stockedInAt.getTime()
  return ymd(new Date(lastReconAt.getTime() + KST_OFFSET_MS)) > ymd(stockedInAt)
}

/**
 * 위치별 "대조가 재고에 반영된 마지막 시각".
 * 대조 ADJUSTMENT 는 파일 스냅샷 수량으로 **절대값 설정**(referenceId = 대조 id)이라, 확정 전(PARTIAL·진행 중)
 * 이라도 ADJUSTMENT 가 적용된 순간 그 위치 재고는 이미 입고분을 반영한 값이다 — 그래서 확정/적용 대조의
 * 확정 시각과 대조 ADJUSTMENT 의 적용 시각(createdAt)을 함께 본다.
 */
export async function loadLastReconAt(
  db: ReadDb,
  spaceId: string,
  opts: { since?: Date; locationIds?: string[] } = {}
): Promise<Map<string, Date>> {
  const locFilter = opts.locationIds ? { locationId: { in: opts.locationIds } } : {}
  const [recons, adjustments] = await Promise.all([
    db.invReconciliation.findMany({
      // 상태 무관 — 확정 전(PENDING·PARTIAL)·취소 대조라도 이미 적용된 ADJUSTMENT 는 실재고에 반영돼 있다
      where: { spaceId, ...locFilter },
      select: { id: true, locationId: true, status: true, confirmedAt: true, createdAt: true },
    }),
    db.invMovement.findMany({
      where: {
        spaceId,
        type: 'ADJUSTMENT',
        referenceId: { not: null },
        ...locFilter,
        ...(opts.since ? { createdAt: { gte: opts.since } } : {}),
      },
      select: { locationId: true, referenceId: true, createdAt: true },
    }),
  ])
  const last = new Map<string, Date>()
  const bump = (locationId: string, at: Date) => {
    const prev = last.get(locationId)
    if (!prev || at > prev) last.set(locationId, at)
  }
  const reconIds = new Set<string>()
  for (const r of recons) {
    reconIds.add(r.id)
    // 확정 시각은 마감된 대조만 — 그 외는 아래 ADJUSTMENT 로만 판단한다
    if (r.status === 'APPLIED' || r.status === 'CONFIRMED')
      bump(r.locationId, r.confirmedAt ?? r.createdAt)
  }
  for (const m of adjustments) {
    if (m.referenceId && reconIds.has(m.referenceId)) bump(m.locationId, m.createdAt)
  }
  return last
}

/** 차수별 등록된 입고·위치별 대조 반영 시각을 배치 조회한다 (N+1 없음). */
export async function loadStockInFacts(
  db: ReadDb,
  spaceId: string,
  runs: RunLite[]
): Promise<Map<string, StockInFacts>> {
  const result = new Map<string, StockInFacts>()
  if (runs.length === 0) return result
  const locationIds = new Set<string>()
  let since: Date | undefined
  for (const r of runs) {
    for (const a of parseStockInAllocations(r.externalStockIns)) locationIds.add(a.locationId)
    if (r.stockedInAt && (!since || r.stockedInAt < since)) since = r.stockedInAt
  }
  const locIds = [...locationIds]

  const [movements, lastRecon, locations] = await Promise.all([
    db.invMovement.findMany({
      where: {
        spaceId,
        OR: runs.map((r) => ({ referenceId: { startsWith: `prodrun:${r.id}:` } })),
      },
      select: { referenceId: true, quantity: true, movementDate: true },
    }),
    locIds.length > 0
      ? loadLastReconAt(db, spaceId, { since, locationIds: locIds })
      : Promise.resolve(new Map<string, Date>()),
    locIds.length > 0
      ? db.invStorageLocation.findMany({
          where: { spaceId, id: { in: locIds } },
          select: { id: true, type: true, externalSource: true },
        })
      : Promise.resolve([]),
  ])
  const ownLocationIds = new Set(
    locations.filter((l) => !isExternalLogisticsLocation(l)).map((l) => l.id)
  )
  for (const r of runs) {
    result.set(r.id, { registered: new Map(), lastReconAtByLocation: lastRecon, ownLocationIds })
  }
  for (const m of movements) {
    if (!m.referenceId) continue
    const runId = m.referenceId.split(':')[1]
    result.get(runId)?.registered.set(m.referenceId, {
      quantity: m.quantity,
      movementDate: m.movementDate,
    })
  }
  return result
}

export function isReconciledAfter(
  facts: StockInFacts,
  locationId: string,
  stockedInAt: Date | null
): boolean {
  return reconciledAfter(
    facts.lastReconAtByLocation.get(locationId),
    stockedInAt,
    facts.ownLocationIds.has(locationId)
  )
}

/** 되돌리기·삭제 불가 사유. null 이면 가능. */
export function revertBlockedReason(run: RunLite, facts: StockInFacts): string | null {
  const allocations = parseStockInAllocations(run.externalStockIns)
  if (allocations.length === 0) {
    return '위치 분배 기록이 없는 입고 완료 차수는 되돌릴 수 없습니다. 재고 조정으로 처리하세요'
  }
  if (facts.registered.size > 0) {
    return '이 차수로 등록된 입고가 있어 되돌릴 수 없습니다. 재고 위치에서 먼저 조정하세요'
  }
  if (allocations.some((a) => isReconciledAfter(facts, a.locationId, run.stockedInAt))) {
    return '입고 이후 재고 대조가 확정된 위치가 있어 되돌릴 수 없습니다'
  }
  return null
}

// ── 행 잠금 (Prisma 7 에 typed FOR UPDATE 가 없어 raw SQL) ──

export async function lockRunRow(tx: Prisma.TransactionClient, runId: string) {
  await tx.$queryRaw`SELECT id FROM "ProductionRun" WHERE id = ${runId} FOR NO KEY UPDATE`
}

/** 데드락 방지를 위해 id 정렬 순서로 잠근다. */
export async function lockLocationRows(tx: Prisma.TransactionClient, locationIds: string[]) {
  for (const id of [...new Set(locationIds)].sort()) {
    await tx.$queryRaw`SELECT id FROM "InvStorageLocation" WHERE id = ${id} FOR NO KEY UPDATE`
  }
}

/**
 * 옵션×위치 재고 행 잠금(applyBatchInbound·대조 ADJUSTMENT 와 같은 행) — 대조 ADJUSTMENT 가 커밋된 뒤의
 * 상태를 보고 판정하도록, 대조 여부 검사 전에 잠근다. optionId→locationId 정렬(applyBatchInbound 와 동일).
 */
export async function lockStockLevelRows(
  tx: Prisma.TransactionClient,
  pairs: Array<{ optionId: string; locationId: string }>
) {
  const sorted = [...new Map(pairs.map((p) => [`${p.optionId}|${p.locationId}`, p])).values()].sort(
    (a, b) =>
      a.optionId === b.optionId
        ? a.locationId.localeCompare(b.locationId)
        : a.optionId.localeCompare(b.optionId)
  )
  for (const p of sorted) {
    await tx.$queryRaw`SELECT id FROM "InvStockLevel" WHERE "optionId" = ${p.optionId} AND "locationId" = ${p.locationId} FOR NO KEY UPDATE`
  }
}

/** 사무실(자체) 위치 INBOUND 한 건 — transition(ownStockIn)과 own-stock-in 이 같은 문구·키를 쓴다. */
export function buildOwnInboundItem(p: {
  runId: string
  runNo: string
  brandName: string | null
  productName: string
  optionName: string
  optionId: string
  locationId: string
  locationName: string
  quantity: number
  dateStr: string
}) {
  const brandPart = p.brandName ? ` · ${p.brandName}` : ''
  return {
    optionId: p.optionId,
    locationId: p.locationId,
    quantity: p.quantity,
    reason: `생산 입고 - 차수 ${p.runNo}${brandPart} · ${p.productName} / ${p.optionName} · ${p.quantity}개 · 위치 ${p.locationName} · 입고일 ${p.dateStr}`,
    referenceId: stockInRefId(p.runId, p.optionId, p.locationId),
  }
}
