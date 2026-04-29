import { NextRequest, NextResponse } from 'next/server'
import { resolveAnyDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { channelFeeRateSchema } from '@/lib/sh/schemas'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; feeRateId: string }> }
) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { channelId, feeRateId } = await params

  // Space 격리 검증
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  const existing = await prisma.channelFeeRate.findFirst({
    where: { id: feeRateId, channelId },
    select: { id: true },
  })
  if (!existing) return errorResponse('수수료율을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = channelFeeRateSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const { categoryName, ratePercent } = parsed.data

  try {
    const feeRate = await prisma.channelFeeRate.update({
      where: { id: feeRateId },
      data: {
        ...(categoryName !== undefined && { categoryName }),
        ...(ratePercent !== undefined && { ratePercent }),
      },
    })
    return NextResponse.json({ feeRate })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return errorResponse('이미 동일한 카테고리명의 수수료율이 존재합니다', 409)
    }
    throw err
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string; feeRateId: string }> }
) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { channelId, feeRateId } = await params

  // Space 격리 검증
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  const existing = await prisma.channelFeeRate.findFirst({
    where: { id: feeRateId, channelId },
    select: { id: true },
  })
  if (!existing) return errorResponse('수수료율을 찾을 수 없습니다', 404)

  await prisma.channelFeeRate.delete({ where: { id: feeRateId } })

  return new NextResponse(null, { status: 204 })
}
