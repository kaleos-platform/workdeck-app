import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { boProductSchema } from '@/lib/bo/schemas'

export async function GET() {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const products = await prisma.boProduct.findMany({
    where: { spaceId: resolved.space.id, isActive: true },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ products })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = boProductSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const d = parsed.data
  const product = await prisma.boProduct.create({
    data: {
      spaceId: resolved.space.id,
      name: d.name,
      category: d.category ?? null,
      oneLinerPitch: d.oneLinerPitch ?? null,
      homepageUrl: d.homepageUrl ?? null,
      targetCustomer: d.targetCustomer ?? null,
      ctaUrl: d.ctaUrl ?? null,
      features: (d.features ?? []) as never,
      customFields: (d.customFields ?? []) as never,
      isActive: d.isActive,
    },
  })

  return NextResponse.json({ product }, { status: 201 })
}
