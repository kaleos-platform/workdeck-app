// @deprecated Phase 3에서 제거. 내부적으로 공용 Channel 테이블 사용.
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type DelChannelType = 'OUTBOUND' | 'TRANSFER'

// channelTypeDef.isSalesChannel → DelChannelType 변환 헬퍼
function isSalesToDelType(isSalesChannel: boolean): DelChannelType {
  return isSalesChannel ? 'OUTBOUND' : 'TRANSFER'
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const isActiveParam = req.nextUrl.searchParams.get('isActive')
  const typeParam = req.nextUrl.searchParams.get('type') as DelChannelType | null

  const where: Record<string, unknown> = { spaceId: resolved.space.id }
  if (isActiveParam === 'true') where.isActive = true
  else if (isActiveParam === 'false') where.isActive = false
  // type 필터 → channelTypeDef.isSalesChannel 필터로 변환 (groupId 파라미터 제거)
  if (typeParam === 'OUTBOUND') where.channelTypeDef = { isSalesChannel: true }
  else if (typeParam === 'TRANSFER') where.channelTypeDef = { isSalesChannel: false }

  const channels = await prisma.channel.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: {
      channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
    },
  })

  // 기존 클라이언트 호환: isSalesChannel → type 필드 추가
  const mapped = channels.map((ch) => ({
    ...ch,
    type: ch.channelTypeDef ? isSalesToDelType(ch.channelTypeDef.isSalesChannel) : 'OUTBOUND',
  }))

  return NextResponse.json({ channels: mapped })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
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

  // type → 시드 ChannelTypeDef 조회 (B2C=OUTBOUND, 내부 이관=TRANSFER)
  const seedName = type === 'TRANSFER' ? '내부 이관' : 'B2C'
  const typeDef = await prisma.channelTypeDef.findFirst({
    where: { spaceId: resolved.space.id, name: seedName, isSystem: true },
    select: { id: true },
  })
  if (!typeDef) return errorResponse(`기본 채널 유형(${seedName})을 찾을 수 없습니다`, 500)

  const channel = await prisma.channel.create({
    data: {
      spaceId: resolved.space.id,
      name,
      channelTypeDefId: typeDef.id,
      requireOrderNumber,
      requirePayment,
      requireProducts,
    },
    include: {
      channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
    },
  })

  return NextResponse.json(
    {
      channel: {
        ...channel,
        type: channel.channelTypeDef
          ? isSalesToDelType(channel.channelTypeDef.isSalesChannel)
          : 'OUTBOUND',
      },
    },
    { status: 201 }
  )
}
