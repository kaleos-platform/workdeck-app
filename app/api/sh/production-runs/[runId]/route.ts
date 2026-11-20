import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productionRunPatchSchema } from '@/lib/sh/schemas'
import { isExternalLogisticsLocation } from '@/lib/inv/location-kind'
import {
  isReconciledAfter,
  loadStockInFacts,
  lockLocationRows,
  lockRunRow,
  parseStockInAllocations,
  revertBlockedReason,
  stockInRefId,
} from '@/lib/sh/production-stock-in'
import { MovementError } from '@/lib/inv/movement-processor'

type Params = { params: Promise<{ runId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { runId } = await params

  const run = await prisma.productionRun.findFirst({
    where: { id: runId, spaceId: resolved.space.id },
    include: {
      brand: { select: { id: true, name: true } },
      items: {
        include: {
          option: {
            select: {
              id: true,
              name: true,
              sku: true,
              deletedAt: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  internalName: true,
                  brand: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
      costs: {
        orderBy: { sortOrder: 'asc' },
      },
      // 세트 기반 차수 — 수정 창에서 세트 단위 입고 분배 입력용
      sets: {
        select: {
          id: true,
          listingId: true,
          listingName: true,
          plannedSetQty: true,
          stockedInSetQty: true,
        },
      },
    },
  })
  if (!run) return errorResponse('생산 발주를 찾을 수 없습니다', 404)

  // 입고 완료 차수 — 위치 분배 결과(등록·대조 상태)와 되돌리기 가능 여부
  let stockIn: {
    allocations: Array<{
      optionId: string
      optionName: string
      locationId: string
      locationName: string
      isExternal: boolean
      quantity: number
      state: 'registered' | 'reconciled' | 'pending'
      registeredQty?: number
      registeredAt?: string
    }>
    canRevert: boolean
    revertBlockedReason: string | null
  } | null = null
  if (run.status === 'STOCKED_IN') {
    const allocations = parseStockInAllocations(run.externalStockIns)
    const facts = (await loadStockInFacts(prisma, resolved.space.id, [run])).get(run.id)!
    const locations = await prisma.invStorageLocation.findMany({
      where: { spaceId: resolved.space.id, id: { in: allocations.map((a) => a.locationId) } },
      select: { id: true, name: true, type: true, externalSource: true },
    })
    const locationById = new Map(locations.map((l) => [l.id, l]))
    const optionNameById = new Map(run.items.map((it) => [it.optionId, it.option.name]))
    const blocked = revertBlockedReason(run, facts)
    stockIn = {
      allocations: allocations.map((a) => {
        const loc = locationById.get(a.locationId)
        const reg = facts.registered.get(stockInRefId(run.id, a.optionId, a.locationId))
        return {
          optionId: a.optionId,
          optionName: optionNameById.get(a.optionId) ?? a.optionId,
          locationId: a.locationId,
          locationName: loc?.name ?? a.locationId,
          isExternal: loc ? isExternalLogisticsLocation(loc) : false,
          quantity: a.quantity,
          state: reg
            ? 'registered'
            : isReconciledAfter(facts, a.locationId, run.stockedInAt)
              ? 'reconciled'
              : 'pending',
          ...(reg
            ? { registeredQty: reg.quantity, registeredAt: reg.movementDate.toISOString() }
            : {}),
        }
      }),
      canRevert: blocked == null,
      revertBlockedReason: blocked,
    }
  }

  return NextResponse.json({
    run: {
      id: run.id,
      runNo: run.runNo,
      status: run.status,
      brand: run.brand ? { id: run.brand.id, name: run.brand.name } : null,
      dueAt: run.dueAt ? run.dueAt.toISOString() : null,
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      orderedConfirmedAt: run.orderedConfirmedAt ? run.orderedConfirmedAt.toISOString() : null,
      stockedInAt: run.stockedInAt ? run.stockedInAt.toISOString() : null,
      stockInLocationId: run.stockInLocationId,
      totalCost: run.totalCost != null ? Number(run.totalCost) : null,
      costMode: run.costMode,
      memo: run.memo,
      stockIn,
      sets: run.sets,
      items: run.items.map((it) => ({
        id: it.id,
        optionId: it.optionId,
        optionName: it.option.name,
        optionDeleted: it.option.deletedAt != null,
        sku: it.option.sku,
        productId: it.option.product.id,
        productName: it.option.product.internalName ?? it.option.product.name,
        productOfficialName: it.option.product.name,
        brandName: it.option.product.brand?.name ?? null,
        quantity: it.quantity,
        stockedInQty: it.stockedInQty,
      })),
      costs: run.costs.map((c) => ({
        id: c.id,
        itemName: c.itemName,
        description: c.description,
        spec: c.spec != null ? Number(c.spec) : null,
        quantity: Number(c.quantity),
        unitPrice: Number(c.unitPrice),
        amount: Number(c.amount),
        note: c.note,
        sortOrder: c.sortOrder,
        category: c.category,
        vatIncluded: c.vatIncluded,
      })),
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error

  const { runId } = await params

  const existing = await prisma.productionRun.findFirst({
    where: { id: runId, spaceId: resolved.space.id },
    select: {
      id: true,
      costMode: true,
      status: true,
      stockedInAt: true,
      completedAt: true,
      externalStockIns: true,
    },
  })
  if (!existing) return errorResponse('생산 발주를 찾을 수 없습니다', 404)

  const body = await req.json().catch(() => ({}))
  const parsed = productionRunPatchSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

  // 모든 상태 변경은 /transition 하나로만 — PATCH 로 우회하면 입고·되돌리기 가드를 건너뛴다.
  if (input.status !== undefined && input.status !== existing.status) {
    return errorResponse('상태 변경은 진행 단계에서 처리하세요', 400)
  }

  if (existing.status === 'STOCKED_IN') {
    // 입고 완료 일자는 대조 이후 판정의 기준이라 직접 바꿀 수 없다 (되돌리기 후 다시 입고 완료)
    const sameDay = (a: Date | null, v: string | null | undefined) =>
      (a ? a.toISOString().slice(0, 10) : null) ===
      (v ? new Date(v).toISOString().slice(0, 10) : null)
    if (
      ('stockedInAt' in body && !sameDay(existing.stockedInAt, input.stockedInAt)) ||
      ('completedAt' in body && !sameDay(existing.completedAt, input.completedAt))
    ) {
      return errorResponse('입고 완료 일자는 되돌리기 후 다시 입고 완료로 바꾸세요', 400)
    }
    // 위치 분배가 기록된 옵션을 빼면 분배·등록 입고와 어긋난다
    if (input.items) {
      const kept = new Set(input.items.map((it) => it.optionId))
      if (parseStockInAllocations(existing.externalStockIns).some((a) => !kept.has(a.optionId))) {
        return errorResponse('위치 분배가 기록된 옵션은 제거할 수 없습니다', 400)
      }
    }
  }

  // items 변경 시 옵션 소속 검증
  if (input.items) {
    const optionIds = input.items.map((it) => it.optionId)
    const validOptions = await prisma.invProductOption.findMany({
      where: { id: { in: optionIds }, product: { spaceId: resolved.space.id } },
      select: { id: true },
    })
    if (validOptions.length !== optionIds.length) {
      return errorResponse('일부 옵션을 찾을 수 없습니다', 400)
    }
  }

  // brandId 처리 — key 존재 여부로 "명시적 변경" vs "변경 없음" 구분
  let resolvedBrandId: string | null | undefined = undefined // undefined = 변경 없음
  if ('brandId' in body) {
    if (input.brandId) {
      const brand = await prisma.brand.findFirst({
        where: { id: input.brandId, spaceId: resolved.space.id },
        select: { id: true },
      })
      if (!brand) return errorResponse('브랜드를 찾을 수 없습니다', 400)
      resolvedBrandId = input.brandId
    } else {
      resolvedBrandId = null // 명시적 clear
    }
  }

  // orderedConfirmedAt / stockedInAt 처리 (PATCH 메타데이터 수정 — 재고 입고 트리거 X)
  let resolvedOrderedConfirmedAt: Date | null | undefined = undefined
  if ('orderedConfirmedAt' in body) {
    resolvedOrderedConfirmedAt = input.orderedConfirmedAt
      ? new Date(input.orderedConfirmedAt)
      : null
  }
  let resolvedStockedInAt: Date | null | undefined = undefined
  if ('stockedInAt' in body) {
    resolvedStockedInAt = input.stockedInAt ? new Date(input.stockedInAt) : null
  }

  // completedAt 처리:
  //   - key 있고 null: 명시적 clear / key 있고 날짜: 그대로 사용
  //   - stockedInAt 명시 수정 시 completedAt 도 동기화 (레거시 호환)
  let resolvedCompletedAt: Date | null | undefined = undefined // undefined = 변경 없음
  if ('completedAt' in body) {
    resolvedCompletedAt = input.completedAt ? new Date(input.completedAt) : null
  } else if (resolvedStockedInAt !== undefined) {
    // stockedInAt 명시 수정 시 completedAt 도 동기화 (레거시 호환)
    resolvedCompletedAt = resolvedStockedInAt
  }

  // costMode 결정 (변경 또는 기존값 유지)
  const effectiveCostMode = input.costMode ?? existing.costMode
  const modeChanged = input.costMode !== undefined && input.costMode !== existing.costMode

  // costs 변경 로직 (두 모드 공통):
  //   - input.costs가 있거나 모드 전환 시 → costs 교체
  //   - BREAKDOWN: totalCost = costs amount 합 (서버 계산)
  //   - TOTAL: totalCost = input.totalCost (클라이언트 합산값)
  //   - 모드 유지 + input.costs 없으면 → costs 변경 없음
  let costsData:
    | Array<{
        itemName: string
        description?: string
        spec?: number
        quantity: number
        unitPrice: number
        amount: number
        note?: string
        sortOrder: number
        category: 'MATERIAL' | 'LABOR' | 'PACKAGING' | 'LOGISTICS' | 'OTHER'
        vatIncluded: boolean
      }>
    | undefined = undefined
  let computedTotalCost: number | undefined | null = undefined // undefined = 변경 없음

  if (input.costs !== undefined || modeChanged) {
    const costsInput = input.costs ?? []
    costsData = costsInput.map((c, i) => ({
      itemName: c.itemName,
      description: c.description,
      spec: c.spec,
      quantity: c.quantity,
      unitPrice: c.unitPrice,
      amount: (c.spec ?? 1) * c.quantity * c.unitPrice,
      note: c.note,
      sortOrder: c.sortOrder ?? i,
      category: c.category ?? 'OTHER',
      vatIncluded: c.vatIncluded ?? true,
    }))
    if (effectiveCostMode === 'BREAKDOWN') {
      computedTotalCost = costsData.reduce((s, c) => s + c.amount, 0)
    }
  }
  if (effectiveCostMode === 'TOTAL' && input.totalCost !== undefined) {
    computedTotalCost = input.totalCost
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.productionRun.update({
        where: { id: runId },
        data: {
          runNo: input.runNo,
          costMode: input.costMode,
          totalCost: computedTotalCost === undefined ? undefined : computedTotalCost,
          memo: input.memo === undefined ? undefined : (input.memo ?? null),
          brandId: resolvedBrandId === undefined ? undefined : resolvedBrandId,
          dueAt: 'dueAt' in body ? (input.dueAt ? new Date(input.dueAt) : null) : undefined,
          completedAt: resolvedCompletedAt === undefined ? undefined : resolvedCompletedAt,
          orderedConfirmedAt:
            resolvedOrderedConfirmedAt === undefined ? undefined : resolvedOrderedConfirmedAt,
          stockedInAt: resolvedStockedInAt === undefined ? undefined : resolvedStockedInAt,
        },
      })

      // items 교체 — 발주 수량만 수정하고 실제 입고 수량(stockedInQty)은 유지.
      // 발주와 입고의 차이를 관리하려면 발주 수량 변경 시에도 기존 입고 값이 보존되어야 한다.
      if (input.items) {
        const prevItems = await tx.productionRunItem.findMany({
          where: { runId },
          select: { optionId: true, stockedInQty: true },
        })
        const stockedByOption = new Map(prevItems.map((p) => [p.optionId, p.stockedInQty]))
        await tx.productionRunItem.deleteMany({ where: { runId } })
        await tx.productionRunItem.createMany({
          data: input.items.map((it) => ({
            runId,
            optionId: it.optionId,
            quantity: it.quantity,
            // 기존 옵션은 입고 수량 유지, 신규 옵션은 null(미입고)
            stockedInQty: stockedByOption.get(it.optionId) ?? null,
          })),
        })
      }

      // costs 교체 (BREAKDOWN 모드이고 costs가 payload에 있을 때)
      if (costsData !== undefined) {
        await tx.productionRunCost.deleteMany({ where: { runId } })
        if (costsData.length > 0) {
          await tx.productionRunCost.createMany({
            data: costsData.map((c) => ({ ...c, runId })),
          })
        }
      }
    })

    return NextResponse.json({ run: { id: runId } })
  } catch (e) {
    const prismaErr = e as { code?: string }
    if (prismaErr.code === 'P2002') {
      return errorResponse('같은 차수 번호가 이미 존재합니다', 409)
    }
    throw e
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error

  const { runId } = await params

  const run = await prisma.productionRun.findFirst({
    where: { id: runId, spaceId: resolved.space.id },
    select: { id: true, status: true },
  })
  if (!run) return errorResponse('생산 발주를 찾을 수 없습니다', 404)

  // 입고 완료 차수는 되돌리기와 같은 조건(분배 기록 있음·등록된 입고 없음·확정 대조 없음)일 때만 삭제.
  if (run.status === 'STOCKED_IN') {
    try {
      await prisma.$transaction(async (tx) => {
        await lockRunRow(tx, runId)
        const fresh = await tx.productionRun.findUnique({
          where: { id: runId },
          select: { id: true, status: true, stockedInAt: true, externalStockIns: true },
        })
        if (!fresh) return
        if (fresh.status === 'STOCKED_IN') {
          await lockLocationRows(
            tx,
            parseStockInAllocations(fresh.externalStockIns).map((a) => a.locationId)
          )
          const facts = (await loadStockInFacts(tx, resolved.space.id, [fresh])).get(runId)!
          const reason = revertBlockedReason(fresh, facts)
          if (reason) throw new MovementError(reason, 409)
        }
        await tx.productionRun.delete({ where: { id: runId } })
      })
    } catch (e) {
      if (e instanceof MovementError) return errorResponse(e.message, e.status)
      throw e
    }
    return NextResponse.json({ ok: true })
  }

  // items/costs는 onDelete: Cascade로 자동 삭제
  await prisma.productionRun.delete({ where: { id: runId } })
  return NextResponse.json({ ok: true })
}
