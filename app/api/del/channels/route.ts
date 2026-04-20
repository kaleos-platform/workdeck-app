// @deprecated Phase 3에서 제거. 내부적으로 공용 Channel 테이블 사용.
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ChannelKind } from '@/generated/prisma/client'

type DelChannelType = 'OUTBOUND' | 'TRANSFER'

// Channel.kind ↔ DelSalesChannel.type 변환 헬퍼
function kindToDelType(kind: ChannelKind): DelChannelType {
  return kind === 'INTERNAL_TRANSFER' ? 'TRANSFER' : 'OUTBOUND'
}
function delTypeToKind(type: DelChannelType): ChannelKind {
  return type === 'TRANSFER' ? ChannelKind.INTERNAL_TRANSFER : ChannelKind.ONLINE_MARKETPLACE
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const groupId = req.nextUrl.searchParams.get('groupId')
  const isActiveParam = req.nextUrl.searchParams.get('isActive')
  const typeParam = req.nextUrl.searchParams.get('type') as DelChannelType | null

  const where: Record<string, unknown> = { spaceId: resolved.space.id }
  if (groupId) where.groupId = groupId
  if (isActiveParam === 'true') where.isActive = true
  else if (isActiveParam === 'false') where.isActive = false
  // type 필터 → kind 필터로 변환
  if (typeParam === 'OUTBOUND') where.kind = { not: ChannelKind.INTERNAL_TRANSFER }
  else if (typeParam === 'TRANSFER') where.kind = ChannelKind.INTERNAL_TRANSFER

  const channels = await prisma.channel.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: {
      group: { select: { id: true, name: true } },
    },
  })

  // 기존 클라이언트 호환: kind → type 필드 추가
  const mapped = channels.map((ch) => ({
    ...ch,
    type: kindToDelType(ch.kind),
  }))

  return NextResponse.json({ channels: mapped })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const groupId: string | null =
    typeof body?.groupId === 'string' && body.groupId.length > 0 ? body.groupId : null
  const type: DelChannelType = body?.type === 'TRANSFER' ? 'TRANSFER' : 'OUTBOUND'
  const requireOrderNumber = body?.requireOrderNumber !== false
  const requirePayment = body?.requirePayment !== false
  const requireProducts = body?.requireProducts !== false

  if (!name) return errorResponse('채널 이름이 필요합니다', 400)
  if (type !== 'OUTBOUND' && type !== 'TRANSFER') {
    return errorResponse('유형(OUTBOUND 또는 TRANSFER)이 필요합니다', 400)
  }

  const duplicate = await prisma.channel.findFirst({
    where: { spaceId: resolved.space.id, name },
  })
  if (duplicate) return errorResponse('이미 존재하는 채널 이름입니다', 409)

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
      kind: delTypeToKind(type),
      requireOrderNumber,
      requirePayment,
      requireProducts,
    },
    include: { group: { select: { id: true, name: true } } },
  })

  return NextResponse.json(
    { channel: { ...channel, type: kindToDelType(channel.kind) } },
    { status: 201 }
  )
}
