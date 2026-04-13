import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const groups = await prisma.invChannelGroup.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { channels: true } },
    },
  })

  return NextResponse.json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      channelCount: g._count.channels,
      createdAt: g.createdAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''

  if (!name) {
    return errorResponse('그룹 이름이 필요합니다', 400)
  }

  const duplicate = await prisma.invChannelGroup.findFirst({
    where: { spaceId: resolved.space.id, name },
    select: { id: true },
  })
  if (duplicate) {
    return errorResponse('이미 존재하는 그룹 이름입니다', 409)
  }

  const group = await prisma.invChannelGroup.create({
    data: { spaceId: resolved.space.id, name },
  })

  return NextResponse.json({ group })
}
