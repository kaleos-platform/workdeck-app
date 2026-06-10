import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productionRunPatchSchema } from '@/lib/sh/schemas'

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
    },
  })
  if (!run) return errorResponse('생산 발주를 찾을 수 없습니다', 404)

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
      })),
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { runId } = await params

  const existing = await prisma.productionRun.findFirst({
    where: { id: runId, spaceId: resolved.space.id },
    select: { id: true, costMode: true, status: true },
  })
  if (!existing) return errorResponse('생산 발주를 찾을 수 없습니다', 404)

  const body = await req.json().catch(() => ({}))
  const parsed = productionRunPatchSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

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
  //   - key 없음 + status → STOCKED_IN: 자동 today
  //   - key 있고 null: 명시적 clear
  //   - key 있고 날짜: 그대로 사용
  // 주의: 재고 입고를 동반하는 STOCKED_IN 전환은 /transition 엔드포인트에서 처리.
  //       PATCH 로 status='STOCKED_IN' 을 직접 보내는 경로는 일반적으로 사용하지 않음.
  let resolvedCompletedAt: Date | null | undefined = undefined // undefined = 변경 없음
  const statusChangingToStockedIn =
    input.status === 'STOCKED_IN' && existing.status !== 'STOCKED_IN'
  if ('completedAt' in body) {
    resolvedCompletedAt = input.completedAt ? new Date(input.completedAt) : null
  } else if (statusChangingToStockedIn) {
    // 자동 today (UTC 자정)
    resolvedCompletedAt = new Date(new Date().toISOString().slice(0, 10))
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
          status: input.status,
          brandId: resolvedBrandId === undefined ? undefined : resolvedBrandId,
          dueAt: 'dueAt' in body ? (input.dueAt ? new Date(input.dueAt) : null) : undefined,
          completedAt: resolvedCompletedAt === undefined ? undefined : resolvedCompletedAt,
          orderedConfirmedAt:
            resolvedOrderedConfirmedAt === undefined ? undefined : resolvedOrderedConfirmedAt,
          stockedInAt: resolvedStockedInAt === undefined ? undefined : resolvedStockedInAt,
        },
      })

      // items 교체
      if (input.items) {
        await tx.productionRunItem.deleteMany({ where: { runId } })
        await tx.productionRunItem.createMany({
          data: input.items.map((it) => ({
            runId,
            optionId: it.optionId,
            quantity: it.quantity,
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
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { runId } = await params

  const run = await prisma.productionRun.findFirst({
    where: { id: runId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!run) return errorResponse('생산 발주를 찾을 수 없습니다', 404)

  // items/costs는 onDelete: Cascade로 자동 삭제
  await prisma.productionRun.delete({ where: { id: runId } })
  return NextResponse.json({ ok: true })
}
