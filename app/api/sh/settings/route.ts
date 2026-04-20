import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { pricingSettingsSchema } from '@/lib/sh/schemas'

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
    },
  })

  return NextResponse.json({ settings })
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

  const { defaultOperatingCostPct, defaultAdCostPct, defaultPackagingCost } = parsed.data

  const settings = await prisma.productPricingSettings.upsert({
    where: { spaceId: resolved.space.id },
    update: {
      defaultOperatingCostPct,
      defaultAdCostPct,
      defaultPackagingCost,
    },
    create: {
      spaceId: resolved.space.id,
      defaultOperatingCostPct,
      defaultAdCostPct,
      defaultPackagingCost,
    },
  })

  return NextResponse.json({ settings })
}
