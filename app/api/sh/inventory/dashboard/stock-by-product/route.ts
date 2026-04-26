import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { searchParams } = req.nextUrl
  const locationId = searchParams.get('locationId') || undefined
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))

  // Get all options with product info, paginated
  const optionWhere = { product: { spaceId } }
  const [options, total] = await Promise.all([
    prisma.invProductOption.findMany({
      where: optionWhere,
      include: {
        product: { select: { name: true, internalName: true } },
        stockLevels: {
          where: locationId ? { locationId } : undefined,
          select: { quantity: true },
        },
      },
      orderBy: { product: { name: 'asc' } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invProductOption.count({ where: optionWhere }),
  ])

  // 90-day outbound aggregation for these options
  const optionIds = options.map((o) => o.id)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

  const outboundAgg =
    optionIds.length > 0
      ? await prisma.invMovement.groupBy({
          by: ['optionId'],
          where: {
            spaceId,
            optionId: { in: optionIds },
            type: 'OUTBOUND',
            movementDate: { gte: ninetyDaysAgo },
            ...(locationId ? { locationId } : {}),
          },
          _sum: { quantity: true },
        })
      : []

  const outboundMap = new Map(outboundAgg.map((a) => [a.optionId, Math.abs(a._sum.quantity ?? 0)]))

  const data = options.map((o) => {
    // 내부 표시용 — 관리명 우선, 없으면 공식명
    const internal = o.product.internalName?.trim()
    const productName = internal && internal.length > 0 ? internal : o.product.name
    return {
      productName,
      optionName: o.name,
      stock: o.stockLevels.reduce((sum, sl) => sum + sl.quantity, 0),
      outbound90d: outboundMap.get(o.id) ?? 0,
    }
  })

  return NextResponse.json({ data, total, page, pageSize })
}
