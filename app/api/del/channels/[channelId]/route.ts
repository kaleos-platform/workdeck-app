import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ channelId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const { channelId } = await params
  const channel = await prisma.delSalesChannel.findUnique({
    where: { id: channelId },
    select: { spaceId: true },
  })
  if (!channel || channel.spaceId !== resolved.space.id) {
    return errorResponse('채널을 찾을 수 없습니다', 404)
  }

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (typeof body?.name === 'string' && body.name.trim()) {
    const name = body.name.trim()
    const duplicate = await prisma.delSalesChannel.findFirst({
      where: { spaceId: resolved.space.id, name, id: { not: channelId } },
    })
    if (duplicate) return errorResponse('이미 존재하는 채널 이름입니다', 409)
    data.name = name
  }

  if (body?.groupId !== undefined) {
    data.groupId = typeof body.groupId === 'string' && body.groupId.length > 0
      ? body.groupId
      : null
  }
  if (typeof body?.isActive === 'boolean') data.isActive = body.isActive
  if (typeof body?.requireOrderNumber === 'boolean') data.requireOrderNumber = body.requireOrderNumber
  if (typeof body?.requirePayment === 'boolean') data.requirePayment = body.requirePayment
  if (typeof body?.requireProducts === 'boolean') data.requireProducts = body.requireProducts
  if (body?.type === 'OUTBOUND' || body?.type === 'TRANSFER') data.type = body.type

  const updated = await prisma.delSalesChannel.update({
    where: { id: channelId },
    data,
    include: { group: { select: { id: true, name: true } } },
  })

  return NextResponse.json({ channel: updated })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const { channelId } = await params
  const channel = await prisma.delSalesChannel.findUnique({
    where: { id: channelId },
    select: { spaceId: true },
  })
  if (!channel || channel.spaceId !== resolved.space.id) {
    return errorResponse('채널을 찾을 수 없습니다', 404)
  }

  await prisma.delSalesChannel.delete({ where: { id: channelId } })

  return NextResponse.json({ success: true })
}
