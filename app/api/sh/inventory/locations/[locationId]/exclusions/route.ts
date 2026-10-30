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

// GET /api/sh/inventory/locations/[locationId]/exclusions — 대조 제외한 외부 코드 목록
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { locationId } = await ctx.params
  if (!(await assertLocation(resolved.space.id, locationId))) {
    return errorResponse('위치를 찾을 수 없습니다', 404)
  }

  const exclusions = await prisma.invReconExcludedCode.findMany({
    where: { locationId, spaceId: resolved.space.id },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ exclusions })
}

// POST /api/sh/inventory/locations/[locationId]/exclusions
// { codes: [{ externalCode, externalName?, externalOptionName? }] } — 이미 제외된 코드는 건너뜀
export async function POST(req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error

  const { locationId } = await ctx.params
  if (!(await assertLocation(resolved.space.id, locationId))) {
    return errorResponse('위치를 찾을 수 없습니다', 404)
  }

  const body = (await req.json().catch(() => ({}))) as {
    codes?: { externalCode?: string; externalName?: string; externalOptionName?: string }[]
  }
  const codes = (body.codes ?? [])
    .map((c) => ({ ...c, externalCode: c.externalCode?.trim() }))
    .filter((c): c is typeof c & { externalCode: string } => !!c.externalCode)
  if (codes.length === 0) return errorResponse('codes가 필요합니다', 400)

  const result = await prisma.invReconExcludedCode.createMany({
    data: codes.map((c) => ({
      spaceId: resolved.space.id,
      locationId,
      externalCode: c.externalCode,
      externalName: c.externalName ?? null,
      externalOptionName: c.externalOptionName ?? null,
    })),
    skipDuplicates: true,
  })
  return NextResponse.json({ created: result.count })
}

// DELETE /api/sh/inventory/locations/[locationId]/exclusions?externalCode=xxx — 제외 해제
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error

  const { locationId } = await ctx.params
  const externalCode = new URL(req.url).searchParams.get('externalCode')?.trim()
  if (!externalCode) return errorResponse('externalCode가 필요합니다', 400)

  const { count } = await prisma.invReconExcludedCode.deleteMany({
    where: { locationId, externalCode, spaceId: resolved.space.id },
  })
  if (count === 0) return errorResponse('제외된 코드를 찾을 수 없습니다', 404)
  return NextResponse.json({ success: true })
}
