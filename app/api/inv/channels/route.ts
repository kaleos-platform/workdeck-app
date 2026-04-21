// @deprecated Phase 3에서 제거. 내부적으로 공용 Channel 테이블 사용.
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const isActiveParam = req.nextUrl.searchParams.get('isActive')
  const where: {
    spaceId: string
    isActive?: boolean
    kind: 'ONLINE_MARKETPLACE' | 'ONLINE_MALL' | 'OFFLINE' | 'INTERNAL_TRANSFER' | 'OTHER'
  } = { spaceId: resolved.space.id, kind: 'ONLINE_MARKETPLACE' }
  if (isActiveParam === 'true') where.isActive = true
  else if (isActiveParam === 'false') where.isActive = false

  const channels = await prisma.channel.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: {
      group: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({ channels })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const groupId: string | null =
    typeof body?.groupId === 'string' && body.groupId.length > 0 ? body.groupId : null

  if (!name) {
    return errorResponse('채널 이름이 필요합니다', 400)
  }

  const duplicate = await prisma.channel.findFirst({
    where: { spaceId: resolved.space.id, name },
    select: { id: true },
  })
  if (duplicate) {
    return errorResponse('이미 존재하는 채널 이름입니다', 409)
  }

  if (groupId) {
    const group = await prisma.channelGroup.findUnique({
      where: { id: groupId },
      select: { spaceId: true },
    })
    if (!group || group.spaceId !== resolved.space.id) {
      return errorResponse('유효하지 않은 그룹입니다', 400)
    }
  }

  const channel = await prisma.channel.create({
    data: {
      spaceId: resolved.space.id,
      name,
      groupId,
      kind: 'ONLINE_MARKETPLACE',
    },
    include: { group: { select: { id: true, name: true } } },
  })

  return NextResponse.json({ channel })
}
