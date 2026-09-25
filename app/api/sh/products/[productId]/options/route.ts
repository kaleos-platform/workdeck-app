import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productOptionSchema } from '@/lib/sh/schemas'
import { costExVat } from '@/lib/sh/cost'
import { loadProductionCostBreakdowns } from '@/lib/sh/production-cost'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  // 해당 상품이 이 Space에 속하는지 확인
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true, useProductionCost: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  const options = await prisma.invProductOption.findMany({
    where: { productId, deletedAt: null },
    orderBy: { name: 'asc' },
  })

  // 옵션별 totalStock 집계 (N+1 방지: groupBy 사용)
  const stockGroups = await prisma.invStockLevel.groupBy({
    by: ['optionId'],
    where: { optionId: { in: options.map((o) => o.id) } },
    _sum: { quantity: true },
  })
  const stockMap = new Map(stockGroups.map((g) => [g.optionId, g._sum.quantity ?? 0]))

  const productionCost =
    (await loadProductionCostBreakdowns(resolved.space.id, [productId])).get(productId) ?? null

  return NextResponse.json({
    options: options.map((o) => {
      const manualCost =
        o.costPrice != null ? costExVat(Number(o.costPrice), o.costVatIncluded) : null
      const linkedCost = product.useProductionCost ? productionCost : null

      return {
        ...o,
        totalStock: stockMap.get(o.id) ?? 0,
        effectiveCostPrice: linkedCost?.totalUnitCost ?? manualCost,
        productionUnitCost: linkedCost?.productionUnitCost ?? manualCost,
        marketingUnitCost: linkedCost?.marketingUnitCost ?? 0,
      }
    }),
    // 기존 UI와의 하위 호환을 위해 합산 단가 alias를 유지한다.
    productionCost: productionCost
      ? { ...productionCost, unitCost: productionCost.totalUnitCost }
      : null,
    useProductionCost: product.useProductionCost,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  // 해당 상품이 이 Space에 속하는지 확인
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = productOptionSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const {
    name,
    sku,
    costPrice,
    costVatIncluded,
    retailPrice,
    sizeLabel,
    setSizeLabel,
    attributeValues,
  } = parsed.data

  const option = await prisma.invProductOption.create({
    data: {
      productId,
      name,
      sku: sku ?? null,
      costPrice: costPrice ?? null,
      ...(costVatIncluded !== undefined && { costVatIncluded }),
      retailPrice: retailPrice ?? null,
      sizeLabel: sizeLabel ?? null,
      setSizeLabel: setSizeLabel ?? null,
      attributeValues: attributeValues ?? undefined,
    },
  })

  return NextResponse.json({ option }, { status: 201 })
}
