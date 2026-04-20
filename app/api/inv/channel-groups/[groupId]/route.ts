import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ groupId: string }> }

export async function PATCH(req: NextRequest, context: RouteContext) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const { groupId } = await context.params
  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''

  if (!name) {
    return errorResponse('그룹 이름이 필요합니다', 400)
  }

  // Phase 3: 공용 ChannelGroup 사용 (InvChannelGroup 제거)
  const existing = await prisma.channelGroup.findUnique({
    where: { id: groupId },
    select: { id: true, spaceId: true },
  })
  if (!existing || existing.spaceId !== resolved.space.id) {
    return errorResponse('그룹을 찾을 수 없습니다', 404)
  }

  const duplicate = await prisma.channelGroup.findFirst({
    where: { spaceId: resolved.space.id, name, NOT: { id: groupId } },
    select: { id: true },
  })
  if (duplicate) {
    return errorResponse('이미 존재하는 그룹 이름입니다', 409)
  }

  const group = await prisma.channelGroup.update({
    where: { id: groupId },
    data: { name },
  })

  return NextResponse.json({ group })
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const { groupId } = await context.params

  const existing = await prisma.channelGroup.findUnique({
    where: { id: groupId },
    select: { id: true, spaceId: true, _count: { select: { channels: true } } },
  })
  if (!existing || existing.spaceId !== resolved.space.id) {
    return errorResponse('그룹을 찾을 수 없습니다', 404)
  }

  if (existing._count.channels > 0) {
    return errorResponse(
      '이 그룹에 속한 채널이 있어 삭제할 수 없습니다. 먼저 채널의 그룹을 변경해 주세요.',
      400
    )
  }

  await prisma.channelGroup.delete({ where: { id: groupId } })

  return NextResponse.json({ success: true })
}
