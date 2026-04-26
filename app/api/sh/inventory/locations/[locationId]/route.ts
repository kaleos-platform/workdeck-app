import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ locationId: string }> }

async function loadLocation(spaceId: string, locationId: string) {
  return prisma.invStorageLocation.findFirst({
    where: { id: locationId, spaceId },
  })
}

async function hasNonZeroStock(locationId: string) {
  const nonZero = await prisma.invStockLevel.findFirst({
    where: { locationId, NOT: { quantity: 0 } },
    select: { id: true },
  })
  return !!nonZero
}

// PATCH /api/inv/locations/[locationId] { name?, isActive? }
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { locationId } = await ctx.params
  const location = await loadLocation(resolved.space.id, locationId)
  if (!location) return errorResponse('위치를 찾을 수 없습니다', 404)

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    isActive?: boolean
  }

  const data: { name?: string; isActive?: boolean } = {}

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return errorResponse('위치명이 필요합니다', 400)
    if (name !== location.name) {
      const duplicate = await prisma.invStorageLocation.findFirst({
        where: {
          spaceId: resolved.space.id,
          name,
          NOT: { id: locationId },
        },
        select: { id: true },
      })
      if (duplicate) return errorResponse('같은 이름의 위치가 이미 존재합니다', 409)
    }
    data.name = name
  }

  if (typeof body.isActive === 'boolean') {
    if (body.isActive === false && location.isActive === true) {
      if (await hasNonZeroStock(locationId)) {
        return errorResponse('재고가 남아있는 위치는 비활성화할 수 없습니다', 400)
      }
    }
    data.isActive = body.isActive
  }

  if (Object.keys(data).length === 0) {
    return errorResponse('변경할 내용이 없습니다', 400)
  }

  const updated = await prisma.invStorageLocation.update({
    where: { id: locationId },
    data,
  })

  return NextResponse.json({ location: updated })
}

// DELETE /api/inv/locations/[locationId] — soft delete (isActive = false)
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { locationId } = await ctx.params
  const location = await loadLocation(resolved.space.id, locationId)
  if (!location) return errorResponse('위치를 찾을 수 없습니다', 404)

  if (location.isActive && (await hasNonZeroStock(locationId))) {
    return errorResponse('재고가 남아있는 위치는 비활성화할 수 없습니다', 400)
  }

  const updated = await prisma.invStorageLocation.update({
    where: { id: locationId },
    data: { isActive: false },
  })

  return NextResponse.json({ location: updated })
}
