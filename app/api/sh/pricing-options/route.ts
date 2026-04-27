import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
// Decimal-like → number | null 변환 헬퍼
function dn(v: { toString(): string } | null | undefined): number | null {
  if (v == null) return null
  return Number(v.toString())
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))
  const search = (searchParams.get('search') ?? '').trim()

  // 옵션 where: product.spaceId로 소속 검증
  const where: Record<string, unknown> = {
    product: { spaceId: resolved.space.id },
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { product: { name: { contains: search, mode: 'insensitive' } } },
      { product: { internalName: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const [options, total] = await Promise.all([
    prisma.invProductOption.findMany({
      where,
      orderBy: [{ product: { name: 'asc' } }, { name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        sku: true,
        costPrice: true,
        retailPrice: true,
        product: {
          select: {
            id: true,
            name: true,
            msrp: true,
            brand: { select: { name: true } },
          },
        },
      },
    }),
    prisma.invProductOption.count({ where }),
  ])

  // 재고 집계
  const optionIds = options.map((o) => o.id)
  const stockByOption = new Map<string, number>()
  if (optionIds.length > 0) {
    const stockRows = await prisma.invStockLevel.groupBy({
      by: ['optionId'],
      where: { optionId: { in: optionIds } },
      _sum: { quantity: true },
    })
    for (const r of stockRows) {
      stockByOption.set(r.optionId, r._sum.quantity ?? 0)
    }
  }

  const data = options.map((o) => ({
    optionId: o.id,
    optionName: o.name,
    sku: o.sku ?? null,
    productId: o.product.id,
    productName: o.product.name,
    brandName: o.product.brand?.name ?? null,
    costPrice: dn(o.costPrice), // null이면 UI에서 직접 입력 유도
    retailPrice: dn(o.retailPrice),
    msrp: dn(o.product.msrp),
    totalStock: stockByOption.get(o.id) ?? 0,
  }))

  return NextResponse.json({ data, total, page, pageSize })
}
