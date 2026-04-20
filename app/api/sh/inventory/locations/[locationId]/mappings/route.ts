import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ locationId: string }> }

async function assertLocation(spaceId: string, locationId: string) {
  return prisma.invStorageLocation.findFirst({
    where: { id: locationId, spaceId },
    select: { id: true },
  })
}

// GET /api/inv/locations/[locationId]/mappings
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { locationId } = await ctx.params
  const location = await assertLocation(resolved.space.id, locationId)
  if (!location) return errorResponse('위치를 찾을 수 없습니다', 404)

  const mappings = await prisma.invLocationProductMap.findMany({
    where: { locationId, spaceId: resolved.space.id },
    orderBy: { createdAt: 'desc' },
    include: {
      option: {
        include: {
          product: { select: { id: true, name: true, code: true } },
        },
      },
    },
  })

  return NextResponse.json({ mappings })
}

// POST /api/inv/locations/[locationId]/mappings
// { optionId, externalCode, externalName?, externalOptionName? }
export async function POST(req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { locationId } = await ctx.params
  const location = await assertLocation(resolved.space.id, locationId)
  if (!location) return errorResponse('위치를 찾을 수 없습니다', 404)

  const body = (await req.json().catch(() => ({}))) as {
    optionId?: string
    externalCode?: string
    externalName?: string
    externalOptionName?: string
  }

  const optionId = body.optionId?.trim()
  const externalCode = body.externalCode?.trim()
  if (!optionId) return errorResponse('optionId가 필요합니다', 400)
  if (!externalCode) return errorResponse('externalCode가 필요합니다', 400)

  // Verify option belongs to this space
  const option = await prisma.invProductOption.findFirst({
    where: { id: optionId, product: { spaceId: resolved.space.id } },
    select: { id: true },
  })
  if (!option) return errorResponse('상품 옵션을 찾을 수 없습니다', 404)

  // Check unique constraint on (locationId, externalCode)
  const existing = await prisma.invLocationProductMap.findUnique({
    where: {
      locationId_externalCode: { locationId, externalCode },
    },
  })
  if (existing) {
    if (existing.optionId !== optionId) {
      return errorResponse('해당 외부 코드는 다른 옵션에 이미 매핑되어 있습니다', 409)
    }
    // Same option — update display fields
    const updated = await prisma.invLocationProductMap.update({
      where: { id: existing.id },
      data: {
        externalName: body.externalName ?? existing.externalName,
        externalOptionName: body.externalOptionName ?? existing.externalOptionName,
      },
    })
    return NextResponse.json({ mapping: updated })
  }

  const mapping = await prisma.invLocationProductMap.create({
    data: {
      spaceId: resolved.space.id,
      locationId,
      optionId,
      externalCode,
      externalName: body.externalName ?? null,
      externalOptionName: body.externalOptionName ?? null,
    },
  })

  return NextResponse.json({ mapping })
}

// DELETE /api/inv/locations/[locationId]/mappings?mappingId=xxx
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { locationId } = await ctx.params
  const { searchParams } = new URL(req.url)
  const mappingId = searchParams.get('mappingId')
  if (!mappingId) return errorResponse('mappingId가 필요합니다', 400)

  const mapping = await prisma.invLocationProductMap.findFirst({
    where: {
      id: mappingId,
      locationId,
      spaceId: resolved.space.id,
    },
    select: { id: true },
  })
  if (!mapping) return errorResponse('매핑을 찾을 수 없습니다', 404)

  await prisma.invLocationProductMap.delete({ where: { id: mapping.id } })

  return NextResponse.json({ success: true })
}
