import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { searchParams } = req.nextUrl
  const groupId = searchParams.get('groupId') || undefined
  const search = (searchParams.get('search') ?? '').trim()
  const locationId = searchParams.get('locationId') || undefined
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))

  // Build product option where
  type OptionWhere = {
    product: {
      spaceId: string
      groupId?: string | null
      OR?: Array<
        | { name: { contains: string; mode: 'insensitive' } }
        | { code: { contains: string; mode: 'insensitive' } }
        | { options: { some: { name: { contains: string; mode: 'insensitive' } } } }
      >
    }
  }

  const optionWhere: OptionWhere = { product: { spaceId } }
  if (groupId === 'none') {
    optionWhere.product.groupId = null
  } else if (groupId) {
    optionWhere.product.groupId = groupId
  }
  if (search) {
    optionWhere.product.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { options: { some: { name: { contains: search, mode: 'insensitive' } } } },
    ]
  }

  // Get all active locations for column headers
  const locations = await prisma.invStorageLocation.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  // Get paginated options with stock levels
  const [options, total] = await Promise.all([
    prisma.invProductOption.findMany({
      where: optionWhere,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            group: { select: { id: true, name: true } },
          },
        },
        stockLevels: {
          select: { locationId: true, quantity: true },
          ...(locationId ? { where: { locationId } } : {}),
        },
      },
      orderBy: [{ product: { name: 'asc' } }, { name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invProductOption.count({ where: optionWhere }),
  ])

  const data = options.map((o) => {
    const stockByLocation = o.stockLevels.map((sl) => ({
      locationId: sl.locationId,
      locationName: locations.find((l) => l.id === sl.locationId)?.name ?? '(알 수 없음)',
      quantity: sl.quantity,
    }))
    const totalStock = o.stockLevels.reduce((sum, sl) => sum + sl.quantity, 0)

    return {
      productId: o.product.id,
      productName: o.product.name,
      groupName: o.product.group?.name ?? null,
      optionId: o.id,
      optionName: o.name,
      totalStock,
      stockByLocation,
    }
  })

  return NextResponse.json({
    data,
    locations: locationId ? locations.filter((l) => l.id === locationId) : locations,
    total,
    page,
    pageSize,
  })
}
