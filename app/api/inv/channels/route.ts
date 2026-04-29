// @deprecated Phase 3에서 제거. 내부적으로 공용 Channel 테이블 사용.
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const isActiveParam = req.nextUrl.searchParams.get('isActive')
  const where: Record<string, unknown> = {
    spaceId: resolved.space.id,
    channelTypeDef: { isSalesChannel: true },
  }
  if (isActiveParam === 'true') where.isActive = true
  else if (isActiveParam === 'false') where.isActive = false

  const channels = await prisma.channel.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: {
      channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
    },
  })

  return NextResponse.json({ channels })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''

  if (!name) return errorResponse('채널 이름이 필요합니다', 400)

  const duplicate = await prisma.channel.findFirst({
    where: { spaceId: resolved.space.id, name },
    select: { id: true },
  })
  if (duplicate) return errorResponse('이미 존재하는 채널 이름입니다', 409)

  const defaultType = await prisma.channelTypeDef.findFirst({
    where: { spaceId: resolved.space.id, name: 'B2C', isSystem: true },
    select: { id: true },
  })
  if (!defaultType) return errorResponse('기본 채널 유형(B2C)을 찾을 수 없습니다', 500)

  const channel = await prisma.channel.create({
    data: {
      spaceId: resolved.space.id,
      name,
      channelTypeDefId: defaultType.id,
    },
    include: { channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } } },
  })

  return NextResponse.json({ channel })
}
