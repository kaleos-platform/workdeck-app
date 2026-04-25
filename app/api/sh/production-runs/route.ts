import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productionRunSchema } from '@/lib/sh/schemas'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const productId = searchParams.get('productId')?.trim() || null
  const search = (searchParams.get('search') ?? '').trim()
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))

  const where: Prisma.ProductionRunWhereInput = { spaceId: resolved.space.id }

  // productId 필터 — 해당 상품의 옵션이 1개라도 포함된 run만
  if (productId) {
    where.items = { some: { option: { productId } } }
  }

  if (search) {
    where.OR = [
      { runNo: { contains: search, mode: 'insensitive' } },
      { memo: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [runs, total] = await Promise.all([
    prisma.productionRun.findMany({
      where,
      orderBy: { orderedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        items: {
          include: {
            option: {
              select: {
                id: true,
                name: true,
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
      },
    }),
    prisma.productionRun.count({ where }),
  ])

  const data = runs.map((run) => {
    const totalQuantity = run.items.reduce((s, it) => s + it.quantity, 0)
    const totalCostNum = run.totalCost != null ? Number(run.totalCost) : null
    const averageUnitCost =
      totalCostNum != null && totalQuantity > 0 ? totalCostNum / totalQuantity : null

    // distinct products
    const productMap = new Map<
      string,
      { id: string; displayName: string; brandName: string | null }
    >()
    for (const it of run.items) {
      const p = it.option.product
      if (!productMap.has(p.id)) {
        productMap.set(p.id, {
          id: p.id,
          displayName: p.internalName ?? p.name,
          brandName: p.brand?.name ?? null,
        })
      }
    }

    return {
      id: run.id,
      runNo: run.runNo,
      orderedAt: run.orderedAt.toISOString(),
      totalCost: totalCostNum,
      costMode: run.costMode,
      memo: run.memo,
      itemCount: run.items.length,
      totalQuantity,
      averageUnitCost,
      products: Array.from(productMap.values()),
      items: run.items.map((it) => ({
        optionId: it.optionId,
        optionName: it.option.name,
        productId: it.option.product.id,
        productName: it.option.product.internalName ?? it.option.product.name,
        quantity: it.quantity,
      })),
      updatedAt: run.updatedAt.toISOString(),
    }
  })

  return NextResponse.json({ data, total, page, pageSize })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const parsed = productionRunSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

  // 옵션 소속 검증 — 모두 같은 spaceId에 속해야 함
  const optionIds = input.items.map((it) => it.optionId)
  const validOptions = await prisma.invProductOption.findMany({
    where: { id: { in: optionIds }, product: { spaceId: resolved.space.id } },
    select: { id: true },
  })
  if (validOptions.length !== optionIds.length) {
    return errorResponse('일부 옵션을 찾을 수 없습니다', 400)
  }

  // BREAKDOWN 모드: amount 서버 계산 + totalCost 캐시
  // TOTAL 모드: body.totalCost 그대로 저장 + costs 빈 배열
  let costsData: Array<{
    itemName: string
    description?: string
    spec?: number
    quantity: number
    unitPrice: number
    amount: number
    note?: string
    sortOrder: number
  }> = []
  let finalTotalCost: number | undefined = undefined

  if (input.costMode === 'BREAKDOWN') {
    costsData = (input.costs ?? []).map((c) => {
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
    finalTotalCost = costsData.reduce((s, c) => s + c.amount, 0)
  } else {
    // TOTAL 모드
    finalTotalCost = input.totalCost
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const run = await tx.productionRun.create({
        data: {
          spaceId: resolved.space.id,
          runNo: input.runNo,
          orderedAt: new Date(input.orderedAt),
          costMode: input.costMode,
          totalCost: finalTotalCost ?? null,
          memo: input.memo ?? null,
        },
      })

      await tx.productionRunItem.createMany({
        data: input.items.map((it) => ({
          runId: run.id,
          optionId: it.optionId,
          quantity: it.quantity,
        })),
      })

      if (input.costMode === 'BREAKDOWN' && costsData.length > 0) {
        await tx.productionRunCost.createMany({
          data: costsData.map((c) => ({ ...c, runId: run.id })),
        })
      }

      return run
    })

    return NextResponse.json({ run: { id: created.id } }, { status: 201 })
  } catch (e) {
    // unique 충돌 (spaceId, runNo)
    if (
      e instanceof Error &&
      e.message.includes('Unique constraint') &&
      e.message.includes('runNo')
    ) {
      return errorResponse('같은 차수 번호가 이미 존재합니다', 409)
    }
    // Prisma P2002
    const prismaErr = e as { code?: string }
    if (prismaErr.code === 'P2002') {
      return errorResponse('같은 차수 번호가 이미 존재합니다', 409)
    }
    throw e
  }
}
