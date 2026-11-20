import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productionRunOwnStockInSchema } from '@/lib/sh/schemas'
import { applyBatchInbound, MovementError } from '@/lib/inv/movement-processor'
import { isExternalLogisticsLocation } from '@/lib/inv/location-kind'
import {
  buildOwnInboundItem,
  loadStockInFacts,
  lockLocationRows,
  lockRunRow,
  lockStockLevelRows,
  parseStockInAllocations,
  stockInRefId,
  isReconciledAfter,
} from '@/lib/sh/production-stock-in'

type Params = { params: Promise<{ runId: string }> }

// 입고 완료된 차수의 자체(사무실 등) 위치 분배분을 재고에 입고 등록한다.
// 차수×옵션×위치당 1회(referenceId 중복 409), 입고 이후 그 위치 확정 대조가 있으면 거부(이중 계상 방지).
export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error

  const { runId } = await params

  const body = await req.json().catch(() => ({}))
  const parsed = productionRunOwnStockInSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data
  const movementDate = new Date(input.movementDate)
  if (isNaN(movementDate.getTime())) return errorResponse('입고일이 올바르지 않습니다', 400)

  const run = await prisma.productionRun.findFirst({
    where: { id: runId, spaceId: resolved.space.id },
    include: {
      brand: { select: { name: true } },
      items: {
        include: {
          option: {
            select: { name: true, product: { select: { name: true, internalName: true } } },
          },
        },
      },
    },
  })
  if (!run) return errorResponse('생산 발주를 찾을 수 없습니다', 404)
  if (run.status !== 'STOCKED_IN') {
    return errorResponse('입고 완료된 차수만 입고 등록할 수 있습니다', 409)
  }

  // 각 entry 는 기록된 분배의 (옵션, 위치)와 일치해야 한다
  const allocKeys = new Set(
    parseStockInAllocations(run.externalStockIns).map((a) => `${a.optionId}|${a.locationId}`)
  )
  const itemByOptionId = new Map(run.items.map((it) => [it.optionId, it]))
  for (const e of input.entries) {
    if (!allocKeys.has(`${e.optionId}|${e.locationId}`) || !itemByOptionId.has(e.optionId)) {
      return errorResponse('차수의 위치 분배에 없는 옵션·위치입니다', 400)
    }
  }

  const locationIds = [...new Set(input.entries.map((e) => e.locationId))]
  const locations = await prisma.invStorageLocation.findMany({
    where: { id: { in: locationIds }, spaceId: resolved.space.id },
  })
  const locationById = new Map(locations.map((l) => [l.id, l]))
  for (const id of locationIds) {
    const loc = locationById.get(id)
    if (!loc) return errorResponse('보관 위치를 찾을 수 없습니다', 404)
    if (!loc.isActive) return errorResponse(`비활성화된 보관 위치입니다: ${loc.name}`, 400)
    if (isExternalLogisticsLocation(loc)) {
      return errorResponse(`외부 물류 위치는 재고 대조로 반영됩니다: ${loc.name}`, 400)
    }
  }

  const items = input.entries.map((e) => {
    const it = itemByOptionId.get(e.optionId)!
    return buildOwnInboundItem({
      runId: run.id,
      runNo: run.runNo,
      brandName: run.brand?.name ?? null,
      productName: it.option.product.internalName ?? it.option.product.name,
      optionName: it.option.name,
      optionId: e.optionId,
      locationId: e.locationId,
      locationName: locationById.get(e.locationId)!.name,
      quantity: e.quantity,
      dateStr: input.movementDate,
    })
  })

  try {
    const results = await prisma.$transaction(
      async (tx) => {
        // 차수 행 → 위치 행 순으로 잠가 되돌리기·대조 확정과 직렬화한다
        await lockRunRow(tx, runId)
        await lockLocationRows(tx, locationIds)

        const fresh = await tx.productionRun.findUnique({
          where: { id: runId },
          select: { id: true, status: true, stockedInAt: true, externalStockIns: true },
        })
        if (!fresh || fresh.status !== 'STOCKED_IN') {
          throw new MovementError('차수 상태가 변경되었습니다. 새로고침 후 다시 시도하세요', 409)
        }

        // 잠근 뒤 다시 읽은 분배로 재검증 (사전 읽기 이후 되돌리기·재입고로 바뀌었을 수 있다)
        const freshKeys = new Set(
          parseStockInAllocations(fresh.externalStockIns).map(
            (a) => `${a.optionId}|${a.locationId}`
          )
        )
        if (input.entries.some((e) => !freshKeys.has(`${e.optionId}|${e.locationId}`))) {
          throw new MovementError('차수의 위치 분배에 없는 옵션·위치입니다', 400)
        }
        // 대조 ADJUSTMENT 와 같은 재고 행을 잠근 뒤 대조 여부를 판정한다
        await lockStockLevelRows(tx, input.entries)

        const facts = (await loadStockInFacts(tx, resolved.space.id, [fresh])).get(runId)!
        for (const e of input.entries) {
          if (facts.registered.has(stockInRefId(runId, e.optionId, e.locationId))) {
            throw new MovementError('이미 입고 등록된 옵션·위치가 있습니다', 409)
          }
          if (isReconciledAfter(facts, e.locationId, fresh.stockedInAt)) {
            throw new MovementError('재고 대조로 이미 반영된 위치입니다', 409)
          }
        }
        return applyBatchInbound(tx, resolved.space.id, items, movementDate)
      },
      { maxWait: 10_000, timeout: 60_000 }
    )
    return NextResponse.json({ movements: results })
  } catch (e) {
    if (e instanceof MovementError) return errorResponse(e.message, e.status)
    throw e
  }
}
