import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productSchema } from '@/lib/sh/schemas'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    include: {
      brand: { select: { id: true, name: true } },
      options: {
        include: {
          productionBatches: {
            orderBy: { producedAt: 'desc' },
          },
        },
        orderBy: { name: 'asc' },
      },
    },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  return NextResponse.json({ product })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  const existing = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('상품을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = productSchema.partial().safeParse(body)
  if (!parsed.success) {
    console.error('[products PATCH] invalid input', {
      productId,
      body,
      errors: parsed.error.flatten(),
    })
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const { brandId, groupId } = parsed.data

  // brandId 소속 검증
  if (brandId) {
    const brand = await prisma.brand.findFirst({
      where: { id: brandId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!brand) return errorResponse('브랜드를 찾을 수 없습니다', 404)
  }

  // groupId 소속 검증
  if (groupId) {
    const group = await prisma.invProductGroup.findFirst({
      where: { id: groupId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!group) return errorResponse('그룹을 찾을 수 없습니다', 404)
  }

  const {
    name,
    nameEn,
    code,
    manufacturer,
    manufactureCountry,
    manufactureDate,
    features,
    certifications,
    msrp,
    description,
    optionAttributes,
  } = parsed.data

  const product = await prisma.invProduct.update({
    where: { id: productId },
    data: {
      ...(name !== undefined && { name }),
      ...(nameEn !== undefined && { nameEn: nameEn ?? null }),
      ...(code !== undefined && { code: code ?? null }),
      ...(brandId !== undefined && { brandId: brandId ?? null }),
      ...(groupId !== undefined && { groupId }),
      ...(manufacturer !== undefined && { manufacturer: manufacturer ?? null }),
      ...(manufactureCountry !== undefined && { manufactureCountry: manufactureCountry ?? null }),
      ...(manufactureDate !== undefined && {
        manufactureDate: manufactureDate ? new Date(manufactureDate) : null,
      }),
      ...(features !== undefined && { features }),
      ...(certifications !== undefined && { certifications }),
      ...(msrp !== undefined && { msrp: msrp ?? null }),
      ...(description !== undefined && { description: description ?? null }),
      ...(optionAttributes !== undefined && { optionAttributes }),
    },
    include: {
      brand: { select: { id: true, name: true } },
      options: true,
    },
  })

  return NextResponse.json({ product })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  const existing = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('상품을 찾을 수 없습니다', 404)

  await prisma.invProduct.delete({ where: { id: productId } })

  return new NextResponse(null, { status: 204 })
}
