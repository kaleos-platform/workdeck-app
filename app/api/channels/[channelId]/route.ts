import { NextRequest, NextResponse } from 'next/server'
import { resolveAnyDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { channelSchema } from '@/lib/sh/schemas'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { channelId } = await params

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    include: {
      group: { select: { id: true, name: true } },
      feeRates: { orderBy: { categoryName: 'asc' } },
    },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  return NextResponse.json({ channel })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { channelId } = await params

  const existing = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('채널을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = channelSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const { groupId } = parsed.data

  // groupId 소속 검증
  if (groupId) {
    const group = await prisma.channelGroup.findFirst({
      where: { id: groupId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!group) return errorResponse('채널 그룹을 찾을 수 없습니다', 404)
  }

  const {
    name,
    kind,
    isActive,
    adminUrl,
    freeShipping,
    usesMarketingBudget,
    shippingFee,
    vatIncludedInFee,
    requireOrderNumber,
    requirePayment,
    requireProducts,
  } = parsed.data

  try {
    const channel = await prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(name !== undefined && { name }),
        ...(kind !== undefined && { kind }),
        ...(groupId !== undefined && { groupId: groupId ?? null }),
        ...(isActive !== undefined && { isActive }),
        ...(adminUrl !== undefined && { adminUrl: adminUrl ?? null }),
        ...(freeShipping !== undefined && { freeShipping }),
        ...(usesMarketingBudget !== undefined && { usesMarketingBudget }),
        ...(shippingFee !== undefined && { shippingFee: shippingFee ?? null }),
        ...(vatIncludedInFee !== undefined && { vatIncludedInFee }),
        ...(requireOrderNumber !== undefined && { requireOrderNumber }),
        ...(requirePayment !== undefined && { requirePayment }),
        ...(requireProducts !== undefined && { requireProducts }),
      },
      include: {
        group: { select: { id: true, name: true } },
        feeRates: { orderBy: { categoryName: 'asc' } },
      },
    })
    return NextResponse.json({ channel })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return errorResponse('이미 동일한 채널 이름이 존재합니다', 409)
    }
    throw err
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { channelId } = await params

  const existing = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('채널을 찾을 수 없습니다', 404)

  // ChannelFeeRate는 onDelete: Cascade로 자동 삭제됨
  await prisma.channel.delete({ where: { id: channelId } })

  return new NextResponse(null, { status: 204 })
}
