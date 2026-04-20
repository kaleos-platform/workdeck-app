import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// GET /api/inv/locations?isActive=true
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = new URL(req.url)
  const isActiveParam = searchParams.get('isActive')

  const where: { spaceId: string; isActive?: boolean } = {
    spaceId: resolved.space.id,
  }
  if (isActiveParam === 'true') where.isActive = true
  else if (isActiveParam === 'false') where.isActive = false

  const locations = await prisma.invStorageLocation.findMany({
    where,
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    include: {
      _count: {
        select: { stockLevels: true },
      },
    },
  })

  return NextResponse.json({ locations })
}

// POST /api/inv/locations { name }
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = (await req.json().catch(() => ({}))) as { name?: string }
  const name = body.name?.trim()
  if (!name) return errorResponse('위치명이 필요합니다', 400)

  const duplicate = await prisma.invStorageLocation.findFirst({
    where: { spaceId: resolved.space.id, name },
    select: { id: true },
  })
  if (duplicate) return errorResponse('같은 이름의 위치가 이미 존재합니다', 409)

  const location = await prisma.invStorageLocation.create({
    data: { spaceId: resolved.space.id, name },
  })

  return NextResponse.json({ location })
}
