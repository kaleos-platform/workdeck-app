import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { pricingSettingsSchema } from '@/lib/sh/schemas'

type Decimal = { toString(): string }

function d(v: Decimal | null | undefined): number {
  if (v == null) return 0
  return Number(v.toString())
}

// 설정 객체를 JSON 직렬화 가능한 형태로 변환 (Decimal → number)
function serializeSettings(s: {
  id: string
  spaceId: string
  defaultOperatingCostPct: Decimal
  defaultAdCostPct: Decimal
  defaultPackagingCost: Decimal
  defaultChannelFeePct: Decimal
  defaultShippingCost: Decimal
  defaultReturnRate: Decimal
  defaultReturnShipping: Decimal
  autoApplyChannelFee: boolean
  autoApplyAdCost: boolean
  autoApplyShipping: boolean
  selfMallTargetGood: Decimal
  selfMallTargetFair: Decimal
  platformTargetGood: Decimal
  platformTargetFair: Decimal
  minimumAcceptableMargin: Decimal
  createdAt: Date
  updatedAt: Date
}) {
  return {
    ...s,
    defaultOperatingCostPct: d(s.defaultOperatingCostPct),
    defaultAdCostPct: d(s.defaultAdCostPct),
    defaultPackagingCost: d(s.defaultPackagingCost),
    defaultChannelFeePct: d(s.defaultChannelFeePct),
    defaultShippingCost: d(s.defaultShippingCost),
    defaultReturnRate: d(s.defaultReturnRate),
    defaultReturnShipping: d(s.defaultReturnShipping),
    selfMallTargetGood: d(s.selfMallTargetGood),
    selfMallTargetFair: d(s.selfMallTargetFair),
    platformTargetGood: d(s.platformTargetGood),
    platformTargetFair: d(s.platformTargetFair),
    minimumAcceptableMargin: d(s.minimumAcceptableMargin),
  }
}

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  // 없으면 기본값으로 lazy-create
  const settings = await prisma.productPricingSettings.upsert({
    where: { spaceId: resolved.space.id },
    update: {},
    create: {
      spaceId: resolved.space.id,
      defaultOperatingCostPct: 0,
      defaultAdCostPct: 0,
      defaultPackagingCost: 0,
      defaultChannelFeePct: 0,
      defaultShippingCost: 0,
      defaultReturnRate: 0,
      defaultReturnShipping: 0,
      autoApplyChannelFee: false,
      autoApplyAdCost: false,
      autoApplyShipping: false,
      selfMallTargetGood: 0.35,
      selfMallTargetFair: 0.25,
      platformTargetGood: 0.25,
      platformTargetFair: 0.15,
      minimumAcceptableMargin: 0.1,
    },
  })

  return NextResponse.json({ settings: serializeSettings(settings) })
}

export async function PUT(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = pricingSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const {
    defaultOperatingCostPct,
    defaultAdCostPct,
    defaultPackagingCost,
    defaultChannelFeePct,
    defaultShippingCost,
    defaultReturnRate,
    defaultReturnShipping,
    autoApplyChannelFee,
    autoApplyAdCost,
    autoApplyShipping,
    selfMallTargetGood,
    selfMallTargetFair,
    platformTargetGood,
    platformTargetFair,
    minimumAcceptableMargin,
  } = parsed.data

  const updateData = {
    defaultOperatingCostPct,
    defaultAdCostPct,
    defaultPackagingCost,
    defaultChannelFeePct,
    defaultShippingCost,
    defaultReturnRate,
    defaultReturnShipping,
    autoApplyChannelFee,
    autoApplyAdCost,
    autoApplyShipping,
    selfMallTargetGood,
    selfMallTargetFair,
    platformTargetGood,
    platformTargetFair,
    minimumAcceptableMargin,
  }

  const settings = await prisma.productPricingSettings.upsert({
    where: { spaceId: resolved.space.id },
    update: updateData,
    create: {
      spaceId: resolved.space.id,
      ...updateData,
    },
  })

  return NextResponse.json({ settings: serializeSettings(settings) })
}
