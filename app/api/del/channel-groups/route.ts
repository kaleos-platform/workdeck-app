import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type DelChannelType = 'OUTBOUND' | 'TRANSFER'
const VALID_TYPES: DelChannelType[] = ['OUTBOUND', 'TRANSFER']

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const typeParam = req.nextUrl.searchParams.get('type') as DelChannelType | null
  const where: { spaceId: string; type?: DelChannelType } = {
    spaceId: resolved.space.id,
  }
  if (typeParam && VALID_TYPES.includes(typeParam)) {
    where.type = typeParam
  }

  const groups = await prisma.delChannelGroup.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { channels: true } },
    },
  })

  return NextResponse.json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      channelCount: g._count.channels,
    })),
  })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const type = body?.type as DelChannelType | undefined

  if (!name) return errorResponse('그룹 이름이 필요합니다', 400)
  if (!type || !VALID_TYPES.includes(type)) {
    return errorResponse('유형(OUTBOUND 또는 TRANSFER)이 필요합니다', 400)
  }

  const duplicate = await prisma.delChannelGroup.findFirst({
    where: { spaceId: resolved.space.id, name },
  })
  if (duplicate) return errorResponse('이미 존재하는 그룹 이름입니다', 409)

  const group = await prisma.delChannelGroup.create({
    data: { spaceId: resolved.space.id, name, type },
  })

  return NextResponse.json({ group }, { status: 201 })
}
