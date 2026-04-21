import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productOptionSchema } from '@/lib/sh/schemas'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string; optionId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, optionId } = await params

  // 상품이 이 Space에 속하는지 확인
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  const option = await prisma.invProductOption.findFirst({
    where: { id: optionId, productId },
  })
  if (!option) return errorResponse('옵션을 찾을 수 없습니다', 404)

  // totalStock 집계
  const stockAgg = await prisma.invStockLevel.aggregate({
    where: { optionId },
    _sum: { quantity: true },
  })

  return NextResponse.json({ option: { ...option, totalStock: stockAgg._sum.quantity ?? 0 } })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string; optionId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, optionId } = await params

  // 상품이 이 Space에 속하는지 확인
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  // 옵션이 해당 상품에 속하는지 확인
  const existing = await prisma.invProductOption.findFirst({
    where: { id: optionId, productId },
    select: { id: true },
  })
  if (!existing) return errorResponse('옵션을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = productOptionSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const { name, sku, costPrice, retailPrice, sizeLabel, setSizeLabel, attributeValues } =
    parsed.data

  const option = await prisma.invProductOption.update({
    where: { id: optionId },
    data: {
      ...(name !== undefined && { name }),
      ...(sku !== undefined && { sku: sku ?? null }),
      ...(costPrice !== undefined && { costPrice: costPrice ?? null }),
      ...(retailPrice !== undefined && { retailPrice: retailPrice ?? null }),
      ...(sizeLabel !== undefined && { sizeLabel: sizeLabel ?? null }),
      ...(setSizeLabel !== undefined && { setSizeLabel: setSizeLabel ?? null }),
      ...(attributeValues !== undefined && { attributeValues }),
    },
  })

  return NextResponse.json({ option })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string; optionId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, optionId } = await params

  // 상품이 이 Space에 속하는지 확인
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  // 옵션이 해당 상품에 속하는지 확인
  const existing = await prisma.invProductOption.findFirst({
    where: { id: optionId, productId },
    select: { id: true },
  })
  if (!existing) return errorResponse('옵션을 찾을 수 없습니다', 404)

  await prisma.invProductOption.delete({ where: { id: optionId } })

  return new NextResponse(null, { status: 204 })
}
