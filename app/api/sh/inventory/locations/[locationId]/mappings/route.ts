import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { getCoupangGradeByExternalCode } from '@/lib/inv/coupang-return-stock'

type RouteContext = { params: Promise<{ locationId: string }> }

async function assertLocation(spaceId: string, locationId: string) {
  return prisma.invStorageLocation.findFirst({
    where: { id: locationId, spaceId },
    select: { id: true, externalSource: true },
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
      items: {
        include: {
          option: {
            include: {
              product: { select: { id: true, name: true, code: true } },
            },
          },
        },
      },
    },
  })

  // 로켓그로스 위치만 상품등급을 붙인다 — 다른 위치는 등급 개념이 없다.
  // 쿠팡이 반품품을 별도 상품으로 재등록해 같은 상품·옵션의 매핑이 여러 개
  // 생기는데, 등급 없이는 목록에서 구분할 수 없다.
  if (location.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH) {
    const gradeByCode = await getCoupangGradeByExternalCode(resolved.space.id)
    if (gradeByCode.size > 0) {
      return NextResponse.json({
        mappings: mappings.map((m) => ({
          ...m,
          externalGrade: gradeByCode.get(m.externalCode) ?? null,
        })),
      })
    }
  }

  return NextResponse.json({ mappings })
}

// POST /api/inv/locations/[locationId]/mappings
// { items: [{optionId, quantity?}], externalCode, externalName?, externalOptionName? }
export async function POST(req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { locationId } = await ctx.params
  const location = await assertLocation(resolved.space.id, locationId)
  if (!location) return errorResponse('위치를 찾을 수 없습니다', 404)

  const body = (await req.json().catch(() => ({}))) as {
    items?: { optionId: string; quantity?: number }[]
    externalCode?: string
    externalName?: string
    externalOptionName?: string
  }

  const externalCode = body.externalCode?.trim()
  const items = body.items ?? []
  if (!externalCode) return errorResponse('externalCode가 필요합니다', 400)
  if (items.length === 0) return errorResponse('items가 필요합니다', 400)

  // 소유권 검증
  const validOptions = await prisma.invProductOption.findMany({
    where: {
      id: { in: items.map((i) => i.optionId) },
      product: { spaceId: resolved.space.id },
    },
    select: { id: true },
  })
  const validOptionIds = new Set(validOptions.map((o) => o.id))
  const validItems = items.filter((i) => validOptionIds.has(i.optionId))
  if (validItems.length === 0) return errorResponse('유효한 상품 옵션이 없습니다', 404)

  // Upsert mapping
  const existing = await prisma.invLocationProductMap.findUnique({
    where: { locationId_externalCode: { locationId, externalCode } },
  })

  let mapId: string
  if (existing) {
    await prisma.invLocationProductMap.update({
      where: { id: existing.id },
      data: {
        externalName: body.externalName ?? existing.externalName,
        externalOptionName: body.externalOptionName ?? existing.externalOptionName,
      },
    })
    mapId = existing.id
  } else {
    const created = await prisma.invLocationProductMap.create({
      data: {
        spaceId: resolved.space.id,
        locationId,
        externalCode,
        externalName: body.externalName ?? null,
        externalOptionName: body.externalOptionName ?? null,
      },
    })
    mapId = created.id
  }

  // items 교체
  await prisma.invLocationProductMapItem.deleteMany({ where: { mapId } })
  await prisma.invLocationProductMapItem.createMany({
    data: validItems.map((i) => ({
      mapId,
      optionId: i.optionId,
      quantity: i.quantity ?? 1,
    })),
  })

  const mapping = await prisma.invLocationProductMap.findUnique({
    where: { id: mapId },
    include: {
      items: {
        include: {
          option: {
            include: { product: { select: { id: true, name: true, code: true } } },
          },
        },
      },
    },
  })

  return NextResponse.json({ mapping })
}

// PATCH /api/inv/locations/[locationId]/mappings?mappingId=xxx
// body: { items: [{optionId, quantity?}] }
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { locationId } = await ctx.params
  const location = await assertLocation(resolved.space.id, locationId)
  if (!location) return errorResponse('위치를 찾을 수 없습니다', 404)

  const { searchParams } = new URL(req.url)
  const mappingId = searchParams.get('mappingId')
  if (!mappingId) return errorResponse('mappingId가 필요합니다', 400)

  const body = (await req.json().catch(() => ({}))) as {
    items?: { optionId: string; quantity?: number }[]
  }
  const items = body.items ?? []
  if (items.length === 0) return errorResponse('items가 필요합니다', 400)

  // 매핑 소유권 검증
  const mapping = await prisma.invLocationProductMap.findFirst({
    where: { id: mappingId, locationId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!mapping) return errorResponse('매핑을 찾을 수 없습니다', 404)

  // 소유권 검증
  const validOptions = await prisma.invProductOption.findMany({
    where: {
      id: { in: items.map((i) => i.optionId) },
      product: { spaceId: resolved.space.id },
    },
    select: { id: true },
  })
  const validOptionIds = new Set(validOptions.map((o) => o.id))
  const validItems = items.filter((i) => validOptionIds.has(i.optionId))
  if (validItems.length === 0) return errorResponse('유효한 상품 옵션이 없습니다', 404)

  // items 교체
  await prisma.invLocationProductMapItem.deleteMany({ where: { mapId: mapping.id } })
  await prisma.invLocationProductMapItem.createMany({
    data: validItems.map((i) => ({
      mapId: mapping.id,
      optionId: i.optionId,
      quantity: i.quantity ?? 1,
    })),
  })

  const updated = await prisma.invLocationProductMap.findUnique({
    where: { id: mapping.id },
    include: {
      items: {
        include: {
          option: {
            include: { product: { select: { id: true, name: true, code: true } } },
          },
        },
      },
    },
  })

  return NextResponse.json({ mapping: updated })
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
