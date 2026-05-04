import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productSchema } from '@/lib/sc/schemas'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const product = await prisma.product.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!product) return errorResponse('판매 상품을 찾을 수 없습니다', 404)

  return NextResponse.json({ product })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.product.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!existing) return errorResponse('판매 상품을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = productSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const data = parsed.data

  const product = await prisma.product.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.oneLinerPitch !== undefined && { oneLinerPitch: data.oneLinerPitch ?? null }),
      ...(data.customFields !== undefined && { customFields: (data.customFields ?? []) as never }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  })
  return NextResponse.json({ product })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.product.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!existing) return errorResponse('판매 상품을 찾을 수 없습니다', 404)

  await prisma.product.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
