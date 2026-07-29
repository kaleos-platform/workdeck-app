import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productOptionSchema } from '@/lib/sh/schemas'
import { costExVat } from '@/lib/sh/cost'

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

  // 완료(입고완료) 생산 차수 가중평균 단가 — Σ ex-VAT 원가 ÷ Σ run 전체 발주수량
  // (원가는 run 단위라 옵션별 분리 불가 — production-runs API의 averageUnitCost와 동일 규약)
  // 공급원가는 ex-VAT 관리: 항목별 vatIncluded=true면 ÷1.1 적용해 매입세액 제외.
  const completedRuns = await prisma.productionRun.findMany({
    where: {
      spaceId: resolved.space.id,
      status: 'STOCKED_IN',
      // 0 = BREAKDOWN 모드 비용 미입력 저장값일 수 있어 제외 (가중평균 왜곡 방지)
      totalCost: { gt: 0 },
      items: { some: { option: { productId } } },
    },
    select: {
      totalCost: true,
      items: { select: { quantity: true } },
      costs: { select: { amount: true, vatIncluded: true } },
    },
  })
  let productionCost: { unitCost: number; runCount: number } | null = null
  if (completedRuns.length > 0) {
    // run별 ex-VAT 원가 합. costs 항목이 있으면 항목별 vatIncluded로 ÷1.1, 없으면(구 데이터) totalCost as-is.
    const totalCost = completedRuns.reduce((sum, r) => {
      const exVat =
        r.costs.length > 0
          ? r.costs.reduce((s, c) => s + costExVat(Number(c.amount), c.vatIncluded), 0)
          : Number(r.totalCost ?? 0)
      return sum + exVat
    }, 0)
    const totalQty = completedRuns.reduce(
      (sum, r) => sum + r.items.reduce((s, it) => s + it.quantity, 0),
      0
    )
    if (totalQty > 0) {
      productionCost = { unitCost: totalCost / totalQty, runCount: completedRuns.length }
    }
  }

  const derivedUnitCost =
    product.useProductionCost && productionCost ? productionCost.unitCost : null

  return NextResponse.json({
    options: options.map((o) => ({
      ...o,
      totalStock: stockMap.get(o.id) ?? 0,
      // 생산차수 연동 시 파생 ex-VAT 원가, 아니면 수동 costPrice의 ex-VAT 환산 (미입력=null 유지)
      effectiveCostPrice:
        derivedUnitCost ??
        (o.costPrice != null ? costExVat(Number(o.costPrice), o.costVatIncluded) : null),
    })),
    productionCost,
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
