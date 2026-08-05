import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ locationId: string }> }

// GET /api/sh/inventory/locations/[locationId]/stock?optionIds=a,b,c
// 지정 옵션들의 이 위치 현재 재고(InvStockLevel.quantity)를 반환. 없는 옵션은 결과에서 누락(=0으로 취급).
export async function GET(req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { locationId } = await ctx.params
  const location = await prisma.invStorageLocation.findFirst({
    where: { id: locationId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!location) return errorResponse('위치를 찾을 수 없습니다', 404)

  const raw = req.nextUrl.searchParams.get('optionIds') ?? ''
  const optionIds = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (optionIds.length === 0) return NextResponse.json({ stocks: [] })

  const stocks = await prisma.invStockLevel.findMany({
    where: { locationId, optionId: { in: optionIds } },
    select: { optionId: true, quantity: true },
  })

  return NextResponse.json({ stocks })
}
