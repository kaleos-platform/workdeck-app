import { NextRequest, NextResponse } from 'next/server'
import { resolveAnyDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { channelFeeRateSchema } from '@/lib/sh/schemas'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { channelId } = await params

  // Space 격리 검증
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  const feeRates = await prisma.channelFeeRate.findMany({
    where: { channelId },
    orderBy: { categoryName: 'asc' },
  })

  return NextResponse.json({ feeRates })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { channelId } = await params

  // Space 격리 검증
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = channelFeeRateSchema.safeParse(body)
  if (!parsed.success) {
    console.error('[fee-rates POST] invalid input', {
      channelId,
      body,
      errors: parsed.error.flatten(),
    })
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const { categoryName, ratePercent } = parsed.data

  try {
    const feeRate = await prisma.channelFeeRate.create({
      data: { channelId, categoryName, ratePercent },
    })
    return NextResponse.json({ feeRate }, { status: 201 })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return errorResponse('이미 동일한 카테고리명의 수수료율이 존재합니다', 409)
    }
    console.error('[fee-rates POST] unexpected', {
      channelId,
      categoryName,
      ratePercent,
      err,
    })
    return errorResponse('수수료율 저장 중 오류가 발생했습니다', 500, {
      detail: err instanceof Error ? err.message : String(err),
    })
  }
}
