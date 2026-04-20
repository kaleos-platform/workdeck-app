import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { brandSchema } from '@/lib/sh/schemas'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { brandId } = await params

  const brand = await prisma.brand.findFirst({
    where: { id: brandId, spaceId: resolved.space.id },
  })
  if (!brand) return errorResponse('브랜드를 찾을 수 없습니다', 404)

  return NextResponse.json({ brand })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { brandId } = await params

  const existing = await prisma.brand.findFirst({
    where: { id: brandId, spaceId: resolved.space.id },
  })
  if (!existing) return errorResponse('브랜드를 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = brandSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  try {
    const brand = await prisma.brand.update({
      where: { id: brandId },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.logoUrl !== undefined && { logoUrl: parsed.data.logoUrl ?? null }),
        ...(parsed.data.memo !== undefined && { memo: parsed.data.memo ?? null }),
      },
    })
    return NextResponse.json({ brand })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return errorResponse('이미 동일한 브랜드명이 존재합니다', 409)
    }
    throw err
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { brandId } = await params

  const existing = await prisma.brand.findFirst({
    where: { id: brandId, spaceId: resolved.space.id },
  })
  if (!existing) return errorResponse('브랜드를 찾을 수 없습니다', 404)

  await prisma.brand.delete({ where: { id: brandId } })

  return new NextResponse(null, { status: 204 })
}
