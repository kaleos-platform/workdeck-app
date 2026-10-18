import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productSchema } from '@/lib/sc/schemas'
import { isSpaceBrand } from '@/lib/sc/brand-profile'

export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const products = await prisma.product.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ products })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content', { write: true })
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = productSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const brandId = parsed.data.brandId ?? null
  if (brandId && !(await isSpaceBrand(resolved.space.id, brandId))) {
    return errorResponse('브랜드를 찾을 수 없습니다', 404)
  }

  const product = await prisma.product.create({
    data: {
      spaceId: resolved.space.id,
      brandId,
      name: parsed.data.name,
      oneLinerPitch: parsed.data.oneLinerPitch ?? null,
      customFields: (parsed.data.customFields ?? []) as never,
      isActive: parsed.data.isActive,
    },
  })
  return NextResponse.json({ product }, { status: 201 })
}
