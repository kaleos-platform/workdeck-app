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
      items: {
        include: {
          option: {
            select: {
              id: true,
              name: true,
              sku: true,
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
      orderedAt: run.orderedAt.toISOString(),
      totalCost: run.totalCost != null ? Number(run.totalCost) : null,
      costMode: run.costMode,
      memo: run.memo,
      items: run.items.map((it) => ({
        id: it.id,
        optionId: it.optionId,
        optionName: it.option.name,
        sku: it.option.sku,
        productId: it.option.product.id,
        productName: it.option.product.internalName ?? it.option.product.name,
        productOfficialName: it.option.product.name,
        brandName: it.option.product.brand?.name ?? null,
        quantity: it.quantity,
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
    select: { id: true, costMode: true },
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

  // costMode 결정 (변경 또는 기존값 유지)
  const effectiveCostMode = input.costMode ?? existing.costMode
  const modeChanged = input.costMode !== undefined && input.costMode !== existing.costMode

  // costs 변경 로직:
  //   - BREAKDOWN 모드이고 input.costs가 있으면 → amount 재계산 + totalCost 캐시
  //   - BREAKDOWN 모드로 전환 시 input.costs 없으면 → costs 빈 배열로 초기화
  //   - TOTAL 모드로 전환 시 → 기존 costs 행 삭제 (DB 정합성 유지)
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
      }>
    | undefined = undefined
  let computedTotalCost: number | undefined | null = undefined // undefined = 변경 없음

  if (effectiveCostMode === 'BREAKDOWN') {
    if (input.costs !== undefined || modeChanged) {
      // costs payload가 있거나 BREAKDOWN으로 모드 전환 시 costs 교체
      const costsInput = input.costs ?? []
      costsData = costsInput.map((c) => {
        const amount = (c.spec ?? 1) * c.quantity * c.unitPrice
        return {
          itemName: c.itemName,
          description: c.description,
          spec: c.spec,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
          amount,
          note: c.note,
          sortOrder: c.sortOrder ?? 0,
        }
      })
      computedTotalCost = costsData.reduce((s, c) => s + c.amount, 0)
    }
  } else {
    // TOTAL 모드
    if (modeChanged) {
      // BREAKDOWN → TOTAL 전환: costs 행 삭제 표시
      costsData = []
    }
    if (input.totalCost !== undefined) {
      computedTotalCost = input.totalCost
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.productionRun.update({
        where: { id: runId },
        data: {
          runNo: input.runNo,
          orderedAt: input.orderedAt ? new Date(input.orderedAt) : undefined,
          costMode: input.costMode,
          totalCost: computedTotalCost === undefined ? undefined : computedTotalCost,
          memo: input.memo === undefined ? undefined : (input.memo ?? null),
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
