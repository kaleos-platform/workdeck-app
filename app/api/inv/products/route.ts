import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))
  const search = (searchParams.get('search') ?? '').trim()
  const sortByRaw = searchParams.get('sortBy') ?? 'name'
  const sortBy = ['name', 'createdAt'].includes(sortByRaw) ? sortByRaw : 'name'
  const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc'

  const where: {
    spaceId: string
    OR?: Array<
      | { name: { contains: string; mode: 'insensitive' } }
      | { code: { contains: string; mode: 'insensitive' } }
    >
  } = { spaceId: resolved.space.id }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [products, total] = await Promise.all([
    prisma.invProduct.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        options: {
          select: {
            id: true,
            stockLevels: { select: { quantity: true } },
          },
        },
      },
    }),
    prisma.invProduct.count({ where }),
  ])

  const data = products.map((p) => {
    const optionsCount = p.options.length
    const totalStock = p.options.reduce(
      (sum, o) => sum + o.stockLevels.reduce((s, sl) => s + sl.quantity, 0),
      0,
    )
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      optionsCount,
      totalStock,
    }
  })

  return NextResponse.json({ data, total, page, pageSize })
}
