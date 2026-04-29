import { NextRequest, NextResponse } from 'next/server'
import { resolveAnyDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { channelSchema } from '@/lib/sh/schemas'
import { normalizeFeeRates } from '@/lib/sh/channel-fee-lookup'

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
      channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
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
    console.error('[channels PATCH] invalid input', {
      channelId,
      body,
      errors: parsed.error.flatten(),
    })
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const {
    name,
    channelTypeDefId,
    isActive,
    useSimulation,
    adminUrl,
    freeShipping,
    freeShippingThreshold,
    usesMarketingBudget,
    applyAdCost,
    shippingFee,
    vatIncludedInFee,
    paymentFeeIncluded,
    paymentFeePct,
    requireOrderNumber,
    requirePayment,
    requireProducts,
    feeRates,
  } = parsed.data

  // channelTypeDefId 변경 시 소속 검증
  if (channelTypeDefId !== undefined) {
    const typeDef = await prisma.channelTypeDef.findFirst({
      where: { id: channelTypeDefId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!typeDef) return errorResponse('채널 유형을 찾을 수 없습니다', 404)
  }

  try {
    const channel = await prisma.$transaction(async (tx) => {
      await tx.channel.update({
        where: { id: channelId },
        data: {
          ...(name !== undefined && { name }),
          ...(channelTypeDefId !== undefined && { channelTypeDefId }),
          ...(isActive !== undefined && { isActive }),
          ...(useSimulation !== undefined && { useSimulation }),
          ...(adminUrl !== undefined && { adminUrl: adminUrl ?? null }),
          ...(freeShipping !== undefined && { freeShipping }),
          ...(freeShippingThreshold !== undefined && {
            freeShippingThreshold: freeShippingThreshold ?? null,
          }),
          ...(usesMarketingBudget !== undefined && { usesMarketingBudget }),
          ...(applyAdCost !== undefined && { applyAdCost }),
          ...(shippingFee !== undefined && { shippingFee: shippingFee ?? null }),
          ...(vatIncludedInFee !== undefined && { vatIncludedInFee }),
          ...(paymentFeeIncluded !== undefined && { paymentFeeIncluded }),
          ...(paymentFeePct !== undefined && { paymentFeePct: paymentFeePct ?? null }),
          ...(requireOrderNumber !== undefined && { requireOrderNumber }),
          ...(requirePayment !== undefined && { requirePayment }),
          ...(requireProducts !== undefined && { requireProducts }),
        },
      })

      // feeRates가 입력되었을 때만 전체 교체. 항상 '기본' 1건 보장
      if (feeRates !== undefined) {
        const normalized = normalizeFeeRates(feeRates)
        await tx.channelFeeRate.deleteMany({ where: { channelId } })
        await tx.channelFeeRate.createMany({
          data: normalized.map((fr) => ({
            channelId,
            categoryName: fr.categoryName,
            ratePercent: fr.ratePercent,
          })),
        })
      }

      return tx.channel.findUniqueOrThrow({
        where: { id: channelId },
        include: {
          channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
          feeRates: { orderBy: { categoryName: 'asc' } },
        },
      })
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

  // ChannelFeeRate, PricingScenarioChannel은 onDelete: Cascade로 자동 삭제됨
  await prisma.channel.delete({ where: { id: channelId } })

  return new NextResponse(null, { status: 204 })
}
