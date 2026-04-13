import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    include: {
      options: {
        orderBy: { createdAt: 'asc' },
        include: { stockLevels: { select: { quantity: true } } },
      },
    },
  })

  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  const options = product.options.map((o) => ({
    id: o.id,
    name: o.name,
    sku: o.sku,
    totalStock: o.stockLevels.reduce((s, sl) => s + sl.quantity, 0),
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  }))

  const optionIds = product.options.map((o) => o.id)
  const movements =
    optionIds.length === 0
      ? []
      : await prisma.invMovement.findMany({
          where: { spaceId: resolved.space.id, optionId: { in: optionIds } },
          orderBy: { movementDate: 'desc' },
          take: 20,
          include: {
            option: { select: { id: true, name: true } },
            location: { select: { id: true, name: true } },
            toLocation: { select: { id: true, name: true } },
          },
        })

  return NextResponse.json({
    id: product.id,
    name: product.name,
    code: product.code,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    options,
    movements: movements.map((m) => ({
      id: m.id,
      type: m.type,
      quantity: m.quantity,
      movementDate: m.movementDate,
      optionId: m.optionId,
      optionName: m.option.name,
      locationId: m.locationId,
      locationName: m.location.name,
      toLocationId: m.toLocationId,
      toLocationName: m.toLocation?.name ?? null,
    })),
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  let body: { name?: string; code?: string | null }
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 본문입니다', 400)
  }

  const data: { name?: string; code?: string | null } = {}

  if (body.name !== undefined) {
    const trimmed = body.name.trim()
    if (!trimmed) return errorResponse('상품명은 비어 있을 수 없습니다', 400)
    data.name = trimmed
  }

  if (body.code !== undefined) {
    if (body.code === null || body.code === '') {
      data.code = null
    } else {
      const trimmed = body.code.trim()
      const conflict = await prisma.invProduct.findFirst({
        where: {
          spaceId: resolved.space.id,
          code: trimmed,
          id: { not: productId },
        },
        select: { id: true },
      })
      if (conflict) return errorResponse('이미 사용 중인 제품코드입니다', 409)
      data.code = trimmed
    }
  }

  if (Object.keys(data).length === 0) {
    return errorResponse('변경할 필드가 없습니다', 400)
  }

  const updated = await prisma.invProduct.update({
    where: { id: productId },
    data,
    select: { id: true, name: true, code: true, updatedAt: true },
  })

  return NextResponse.json(updated)
}
