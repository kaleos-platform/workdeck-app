import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  let groups = await prisma.delChannelGroup.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { channels: true } },
    },
  })

  if (groups.length === 0) {
    const defaultGroup = await prisma.delChannelGroup.create({
      data: { spaceId: resolved.space.id, name: '기본' },
      include: { _count: { select: { channels: true } } },
    })
    groups = [defaultGroup]
  }

  return NextResponse.json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      channelCount: g._count.channels,
    })),
  })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''

  if (!name) return errorResponse('그룹 이름이 필요합니다', 400)

  const duplicate = await prisma.delChannelGroup.findFirst({
    where: { spaceId: resolved.space.id, name },
  })
  if (duplicate) return errorResponse('이미 존재하는 그룹 이름입니다', 409)

  const group = await prisma.delChannelGroup.create({
    data: { spaceId: resolved.space.id, name },
  })

  return NextResponse.json({ group }, { status: 201 })
}
