// @deprecated Phase 3에서 제거. 내부적으로 공용 Channel 테이블 사용.
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ channelId: string }> }

export async function PATCH(req: NextRequest, context: RouteContext) {
  const resolved = await resolveDeckContext('inventory-mgmt')
  if ('error' in resolved) return resolved.error

  const { channelId } = await context.params
  const body = await req.json().catch(() => ({}))

  const existing = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, spaceId: true },
  })
  if (!existing || existing.spaceId !== resolved.space.id) {
    return errorResponse('채널을 찾을 수 없습니다', 404)
  }

  const data: {
    name?: string
    groupId?: string | null
    isActive?: boolean
  } = {}

  if (body?.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return errorResponse('채널 이름이 필요합니다', 400)
    }
    const name = body.name.trim()
    const duplicate = await prisma.channel.findFirst({
      where: { spaceId: resolved.space.id, name, NOT: { id: channelId } },
      select: { id: true },
    })
    if (duplicate) {
      return errorResponse('이미 존재하는 채널 이름입니다', 409)
    }
    data.name = name
  }

  if (body?.groupId !== undefined) {
    if (body.groupId === null || body.groupId === '') {
      data.groupId = null
    } else if (typeof body.groupId === 'string') {
      const group = await prisma.channelGroup.findUnique({
        where: { id: body.groupId },
        select: { spaceId: true },
      })
      if (!group || group.spaceId !== resolved.space.id) {
        return errorResponse('유효하지 않은 그룹입니다', 400)
      }
      data.groupId = body.groupId
    } else {
      return errorResponse('유효하지 않은 그룹입니다', 400)
    }
  }

  if (body?.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') {
      return errorResponse('isActive는 boolean이어야 합니다', 400)
    }
    data.isActive = body.isActive
  }

  const channel = await prisma.channel.update({
    where: { id: channelId },
    data,
    include: { group: { select: { id: true, name: true } } },
  })

  return NextResponse.json({ channel })
}
