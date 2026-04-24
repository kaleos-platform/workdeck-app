import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { b2bProductSchema } from '@/lib/sc/schemas'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const product = await prisma.b2BProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!product) return errorResponse('판매 상품을 찾을 수 없습니다', 404)

  return NextResponse.json({ product })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.b2BProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!existing) return errorResponse('판매 상품을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = b2bProductSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const data = parsed.data

  try {
    const product = await prisma.b2BProduct.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.slug !== undefined && { slug: data.slug }),
        ...(data.oneLinerPitch !== undefined && { oneLinerPitch: data.oneLinerPitch ?? null }),
        ...(data.valueProposition !== undefined && {
          valueProposition: data.valueProposition ?? null,
        }),
        ...(data.targetCustomers !== undefined && {
          targetCustomers: data.targetCustomers ?? null,
        }),
        ...(data.keyFeatures !== undefined && { keyFeatures: data.keyFeatures ?? undefined }),
        ...(data.differentiators !== undefined && {
          differentiators: data.differentiators ?? undefined,
        }),
        ...(data.painPointsAddressed !== undefined && {
          painPointsAddressed: data.painPointsAddressed ?? undefined,
        }),
        ...(data.proofPoints !== undefined && { proofPoints: data.proofPoints ?? undefined }),
        ...(data.pricingModel !== undefined && { pricingModel: data.pricingModel ?? null }),
        ...(data.priceMin !== undefined && { priceMin: data.priceMin ?? null }),
        ...(data.priceMax !== undefined && { priceMax: data.priceMax ?? null }),
        ...(data.ctaTargetUrl !== undefined && { ctaTargetUrl: data.ctaTargetUrl ?? null }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    })
    return NextResponse.json({ product })
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

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.b2BProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!existing) return errorResponse('판매 상품을 찾을 수 없습니다', 404)

  await prisma.b2BProduct.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
