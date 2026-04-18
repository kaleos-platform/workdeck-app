import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type DelChannelType = 'OUTBOUND' | 'TRANSFER'

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
  if (typeParam === 'OUTBOUND' || typeParam === 'TRANSFER') where.type = typeParam

  const channels = await prisma.delSalesChannel.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: {
      group: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({ channels })
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

  const duplicate = await prisma.delSalesChannel.findFirst({
    where: { spaceId: resolved.space.id, name },
  })
  if (duplicate) return errorResponse('이미 존재하는 채널 이름입니다', 409)

  if (groupId) {
    const group = await prisma.delChannelGroup.findUnique({
      where: { id: groupId },
      select: { spaceId: true },
    })
    if (!group || group.spaceId !== resolved.space.id) {
      return errorResponse('유효하지 않은 그룹입니다', 400)
    }
  }

  const channel = await prisma.delSalesChannel.create({
    data: {
      spaceId: resolved.space.id,
      name,
      groupId,
      type,
      requireOrderNumber,
      requirePayment,
      requireProducts,
    },
    include: { group: { select: { id: true, name: true } } },
  })

  return NextResponse.json({ channel }, { status: 201 })
}
