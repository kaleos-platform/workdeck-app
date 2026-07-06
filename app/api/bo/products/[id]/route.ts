import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { boProductSchema } from '@/lib/bo/schemas'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const product = await prisma.boProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!product) return errorResponse('제품을 찾을 수 없습니다', 404)

  return NextResponse.json({ product })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.boProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!existing) return errorResponse('제품을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = boProductSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const d = parsed.data
  const product = await prisma.boProduct.update({
    where: { id },
    data: {
      ...(d.name !== undefined && { name: d.name }),
      ...(d.category !== undefined && { category: d.category ?? null }),
      ...(d.oneLinerPitch !== undefined && { oneLinerPitch: d.oneLinerPitch ?? null }),
      ...(d.homepageUrl !== undefined && { homepageUrl: d.homepageUrl ?? null }),
      ...(d.targetCustomer !== undefined && { targetCustomer: d.targetCustomer ?? null }),
      ...(d.ctaUrl !== undefined && { ctaUrl: d.ctaUrl ?? null }),
      ...(d.features !== undefined && { features: (d.features ?? []) as never }),
      ...(d.customFields !== undefined && { customFields: (d.customFields ?? []) as never }),
      ...(d.isActive !== undefined && { isActive: d.isActive }),
    },
  })

  return NextResponse.json({ product })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.boProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!existing) return errorResponse('제품을 찾을 수 없습니다', 404)

  // 소프트 삭제 — isActive=false
  await prisma.boProduct.update({
    where: { id },
    data: { isActive: false },
  })

  return new NextResponse(null, { status: 204 })
}
