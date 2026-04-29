import { NextRequest, NextResponse } from 'next/server'
import { resolveAnyDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { channelSchema } from '@/lib/sh/schemas'
import { normalizeFeeRates } from '@/lib/sh/channel-fee-lookup'

export async function GET(req: NextRequest) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const isActiveParam = searchParams.get('isActive')
  const channelTypeDefId = searchParams.get('channelTypeDefId')

  const where: Record<string, unknown> = { spaceId: resolved.space.id }
  if (isActiveParam === 'true') where.isActive = true
  else if (isActiveParam === 'false') where.isActive = false
  if (channelTypeDefId) where.channelTypeDefId = channelTypeDefId

  const channels = await prisma.channel.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
      feeRates: {
        select: { categoryName: true, ratePercent: true },
        orderBy: { categoryName: 'asc' },
      },
    },
  })

  return NextResponse.json({ channels })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = channelSchema.safeParse(body)
  if (!parsed.success) {
    console.error('[channels POST] invalid input', {
      spaceId: resolved.space.id,
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

  // channelTypeDefId 소속 검증
  const typeDef = await prisma.channelTypeDef.findFirst({
    where: { id: channelTypeDefId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!typeDef) return errorResponse('채널 유형을 찾을 수 없습니다', 404)

  // feeRates 정규화 — '기본' 카테고리는 항상 1건 보장
  const normalizedFeeRates = normalizeFeeRates(feeRates)

  try {
    const channel = await prisma.$transaction(async (tx) => {
      const created = await tx.channel.create({
        data: {
          spaceId: resolved.space.id,
          name,
          channelTypeDefId,
          isActive,
          useSimulation,
          adminUrl: adminUrl ?? null,
          freeShipping,
          freeShippingThreshold: freeShippingThreshold ?? null,
          usesMarketingBudget,
          applyAdCost,
          shippingFee: shippingFee ?? null,
          vatIncludedInFee,
          paymentFeeIncluded,
          paymentFeePct: paymentFeePct ?? null,
          requireOrderNumber,
          requirePayment,
          requireProducts,
        },
      })

      await tx.channelFeeRate.createMany({
        data: normalizedFeeRates.map((fr) => ({
          channelId: created.id,
          categoryName: fr.categoryName,
          ratePercent: fr.ratePercent,
        })),
      })

      return tx.channel.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
          feeRates: { orderBy: { categoryName: 'asc' } },
        },
      })
    })
    return NextResponse.json({ channel }, { status: 201 })
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
