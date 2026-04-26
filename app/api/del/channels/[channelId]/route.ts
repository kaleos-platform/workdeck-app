// @deprecated Phase 3에서 제거. 내부적으로 공용 Channel 테이블 사용.
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ChannelKind } from '@/generated/prisma/client'

type DelChannelType = 'OUTBOUND' | 'TRANSFER'
type Params = { params: Promise<{ channelId: string }> }

// Channel.kind ↔ DelSalesChannel.type 변환 헬퍼
function kindToDelType(kind: ChannelKind): DelChannelType {
  return kind === 'INTERNAL_TRANSFER' ? 'TRANSFER' : 'OUTBOUND'
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const { channelId } = await params
  const existing = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { spaceId: true },
  })
  if (!existing || existing.spaceId !== resolved.space.id) {
    return errorResponse('채널을 찾을 수 없습니다', 404)
  }

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (typeof body?.name === 'string' && body.name.trim()) {
    const name = body.name.trim()
    const duplicate = await prisma.channel.findFirst({
      where: { spaceId: resolved.space.id, name, id: { not: channelId } },
    })
    if (duplicate) return errorResponse('이미 존재하는 채널 이름입니다', 409)
    data.name = name
  }

  if (body?.groupId !== undefined) {
    data.groupId = typeof body.groupId === 'string' && body.groupId.length > 0 ? body.groupId : null
  }
  if (typeof body?.isActive === 'boolean') data.isActive = body.isActive
  if (typeof body?.requireOrderNumber === 'boolean')
    data.requireOrderNumber = body.requireOrderNumber
  if (typeof body?.requirePayment === 'boolean') data.requirePayment = body.requirePayment
  if (typeof body?.requireProducts === 'boolean') data.requireProducts = body.requireProducts
  // type → kind 변환
  if (body?.type === 'TRANSFER') data.kind = ChannelKind.INTERNAL_TRANSFER
  else if (body?.type === 'OUTBOUND') data.kind = ChannelKind.ONLINE_MARKETPLACE

  const updated = await prisma.channel.update({
    where: { id: channelId },
    data,
    include: { group: { select: { id: true, name: true } } },
  })

  return NextResponse.json({ channel: { ...updated, type: kindToDelType(updated.kind) } })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const { channelId } = await params
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { spaceId: true },
  })
  if (!channel || channel.spaceId !== resolved.space.id) {
    return errorResponse('채널을 찾을 수 없습니다', 404)
  }

  await prisma.channel.delete({ where: { id: channelId } })

  return NextResponse.json({ success: true })
}
