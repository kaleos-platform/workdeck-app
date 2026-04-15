import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
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

  const groupIdParam = searchParams.get('groupId')

  const where: {
    spaceId: string
    groupId?: string | null
    OR?: Array<
      | { name: { contains: string; mode: 'insensitive' } }
      | { code: { contains: string; mode: 'insensitive' } }
    >
  } = { spaceId: resolved.space.id }

  if (groupIdParam === 'none') {
    where.groupId = null
  } else if (groupIdParam) {
    where.groupId = groupIdParam
  }

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
        group: { select: { id: true, name: true } },
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
      groupId: p.group?.id ?? null,
      groupName: p.group?.name ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      optionsCount,
      totalStock,
    }
  })

  return NextResponse.json({ data, total, page, pageSize })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  let body: { name?: string; code?: string; groupId?: string; options?: { name: string; sku?: string }[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ message: '잘못된 요청 형식입니다' }, { status: 400 })
  }

  const name = (body.name ?? '').trim()
  if (!name) {
    return NextResponse.json({ message: '상품명은 필수입니다' }, { status: 400 })
  }

  const options = body.options
  if (!Array.isArray(options) || options.length === 0) {
    return NextResponse.json({ message: '최소 1개의 옵션이 필요합니다' }, { status: 400 })
  }

  for (const o of options) {
    if (!o.name || !o.name.trim()) {
      return NextResponse.json({ message: '모든 옵션에 이름이 필요합니다' }, { status: 400 })
    }
  }

  const code = body.code?.trim() || null

  // Verify groupId if provided
  let groupId: string | null = null
  if (body.groupId) {
    const group = await prisma.invProductGroup.findFirst({
      where: { id: body.groupId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!group) return errorResponse('그룹을 찾을 수 없습니다', 404)
    groupId = group.id
  }

  try {
    const product = await prisma.invProduct.create({
      data: {
        spaceId: resolved.space.id,
        name,
        code,
        groupId,
        options: {
          create: options.map((o) => ({
            name: o.name.trim(),
            sku: o.sku?.trim() || null,
          })),
        },
      },
      include: { options: true },
    })

    return NextResponse.json({ product }, { status: 201 })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        { message: '이미 동일한 제품코드가 존재합니다' },
        { status: 409 },
      )
    }
    throw err
  }
}
