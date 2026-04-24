import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { b2bProductSchema } from '@/lib/sc/schemas'

export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const products = await prisma.b2BProduct.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ products })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = b2bProductSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  try {
    const product = await prisma.b2BProduct.create({
      data: {
        spaceId: resolved.space.id,
        name: parsed.data.name,
        slug: parsed.data.slug,
        oneLinerPitch: parsed.data.oneLinerPitch ?? null,
        valueProposition: parsed.data.valueProposition ?? null,
        targetCustomers: parsed.data.targetCustomers ?? null,
        keyFeatures: parsed.data.keyFeatures ?? undefined,
        differentiators: parsed.data.differentiators ?? undefined,
        painPointsAddressed: parsed.data.painPointsAddressed ?? undefined,
        proofPoints: parsed.data.proofPoints ?? undefined,
        pricingModel: parsed.data.pricingModel ?? null,
        priceMin: parsed.data.priceMin ?? null,
        priceMax: parsed.data.priceMax ?? null,
        ctaTargetUrl: parsed.data.ctaTargetUrl ?? null,
        isActive: parsed.data.isActive,
      },
    })
    return NextResponse.json({ product }, { status: 201 })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return errorResponse('이미 동일한 slug의 상품이 존재합니다', 409)
    }
    throw err
  }
}
