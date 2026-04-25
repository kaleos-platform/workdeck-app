import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ productId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  // 상품이 같은 Space에 속하는지 확인
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  const { searchParams } = req.nextUrl
  const search = (searchParams.get('search') ?? '').trim()
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))

  const where: Prisma.ProductionRunWhereInput = {
    spaceId: resolved.space.id,
    items: { some: { option: { productId } } },
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

    // 이 상품 옵션만 필터
    const myItems = run.items
      .filter((it) => it.option.product.id === productId)
      .map((it) => ({
        optionId: it.optionId,
        optionName: it.option.name,
        quantity: it.quantity,
      }))

    // distinct products (전체 run 기준)
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
      myItems,
      updatedAt: run.updatedAt.toISOString(),
    }
  })

  return NextResponse.json({ data, total, page, pageSize })
}
