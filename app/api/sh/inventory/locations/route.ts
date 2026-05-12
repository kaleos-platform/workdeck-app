import { NextRequest, NextResponse } from 'next/server'
import { InvStorageLocationType } from '@/generated/prisma/client'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const LOCATION_TYPES: ReadonlySet<InvStorageLocationType> = new Set([
  InvStorageLocationType.OWN,
  InvStorageLocationType.THIRD_PARTY,
  InvStorageLocationType.STORE,
])

function parseLocationType(v: unknown): InvStorageLocationType | undefined {
  if (typeof v !== 'string') return undefined
  return LOCATION_TYPES.has(v as InvStorageLocationType) ? (v as InvStorageLocationType) : undefined
}

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

// POST /api/inv/locations { name, type? }
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    type?: string
  }
  const name = body.name?.trim()
  if (!name) return errorResponse('위치명이 필요합니다', 400)

  const type = parseLocationType(body.type)
  if (body.type !== undefined && !type) {
    return errorResponse('type은 OWN, THIRD_PARTY, STORE 중 하나여야 합니다', 400)
  }

  const duplicate = await prisma.invStorageLocation.findFirst({
    where: { spaceId: resolved.space.id, name },
    select: { id: true },
  })
  if (duplicate) return errorResponse('같은 이름의 위치가 이미 존재합니다', 409)

  const location = await prisma.invStorageLocation.create({
    data: {
      spaceId: resolved.space.id,
      name,
      ...(type !== undefined ? { type } : {}),
    },
  })

  return NextResponse.json({ location })
}
