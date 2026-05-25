import { NextRequest, NextResponse } from 'next/server'
import { InvStorageLocationType } from '@/generated/prisma/client'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import {
  isExternalSource,
  EXTERNAL_SOURCE_LABEL,
  type ExternalSource,
} from '@/lib/inv/external-sources'

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
    externalSource?: string | null
  }
  const name = body.name?.trim()
  if (!name) return errorResponse('위치명이 필요합니다', 400)

  const type = parseLocationType(body.type)
  if (body.type !== undefined && !type) {
    return errorResponse('type은 OWN, THIRD_PARTY, STORE 중 하나여야 합니다', 400)
  }

  let externalSource: ExternalSource | null = null
  if (body.externalSource != null && body.externalSource !== '') {
    if (!isExternalSource(body.externalSource)) {
      return errorResponse('지원하지 않는 연결 소스입니다', 400)
    }
    externalSource = body.externalSource
  }

  const duplicate = await prisma.invStorageLocation.findFirst({
    where: { spaceId: resolved.space.id, name },
    select: { id: true },
  })
  if (duplicate) return errorResponse('같은 이름의 위치가 이미 존재합니다', 409)

  if (externalSource) {
    const dup = await prisma.invStorageLocation.findFirst({
      where: { spaceId: resolved.space.id, externalSource },
      select: { id: true, name: true },
    })
    if (dup) {
      return errorResponse(
        `이미 '${dup.name}' 위치가 ${EXTERNAL_SOURCE_LABEL[externalSource]} 소스에 연결되어 있습니다`,
        409
      )
    }
  }

  const location = await prisma.invStorageLocation.create({
    data: {
      spaceId: resolved.space.id,
      name,
      ...(type !== undefined ? { type } : {}),
      ...(externalSource ? { externalSource } : {}),
    },
  })

  return NextResponse.json({ location })
}
