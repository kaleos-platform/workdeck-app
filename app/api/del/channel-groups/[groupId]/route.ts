import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ groupId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const { groupId } = await params
  const group = await prisma.delChannelGroup.findUnique({
    where: { id: groupId },
    select: { spaceId: true },
  })
  if (!group || group.spaceId !== resolved.space.id) {
    return errorResponse('그룹을 찾을 수 없습니다', 404)
  }

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return errorResponse('그룹 이름이 필요합니다', 400)

  const duplicate = await prisma.delChannelGroup.findFirst({
    where: { spaceId: resolved.space.id, name, id: { not: groupId } },
  })
  if (duplicate) return errorResponse('이미 존재하는 그룹 이름입니다', 409)

  const updated = await prisma.delChannelGroup.update({
    where: { id: groupId },
    data: { name },
  })

  return NextResponse.json({ group: updated })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const { groupId } = await params
  const group = await prisma.delChannelGroup.findUnique({
    where: { id: groupId },
    select: { spaceId: true },
  })
  if (!group || group.spaceId !== resolved.space.id) {
    return errorResponse('그룹을 찾을 수 없습니다', 404)
  }

  const groupCount = await prisma.delChannelGroup.count({
    where: { spaceId: resolved.space.id },
  })
  if (groupCount <= 1) {
    return errorResponse('마지막 그룹은 삭제할 수 없습니다', 400)
  }

  // 소속 채널의 groupId를 null로 설정
  await prisma.delSalesChannel.updateMany({
    where: { groupId },
    data: { groupId: null },
  })

  await prisma.delChannelGroup.delete({ where: { id: groupId } })

  return NextResponse.json({ success: true })
}
