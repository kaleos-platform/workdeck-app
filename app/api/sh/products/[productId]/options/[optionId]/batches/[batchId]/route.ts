import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productionBatchSchema } from '@/lib/sh/schemas'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string; optionId: string; batchId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, optionId, batchId } = await params

  // Space 격리 검증
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  const option = await prisma.invProductOption.findFirst({
    where: { id: optionId, productId },
    select: { id: true },
  })
  if (!option) return errorResponse('옵션을 찾을 수 없습니다', 404)

  const existing = await prisma.productionBatch.findFirst({
    where: { id: batchId, optionId },
    select: { id: true },
  })
  if (!existing) return errorResponse('생산차수를 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = productionBatchSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const { batchNo, producedAt, unitCost, quantity, memo } = parsed.data

  try {
    const batch = await prisma.productionBatch.update({
      where: { id: batchId },
      data: {
        ...(batchNo !== undefined && { batchNo }),
        ...(producedAt !== undefined && { producedAt: new Date(producedAt) }),
        ...(unitCost !== undefined && { unitCost }),
        ...(quantity !== undefined && { quantity: quantity ?? null }),
        ...(memo !== undefined && { memo: memo ?? null }),
      },
    })
    return NextResponse.json({ batch })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return errorResponse('이미 동일한 차수 번호가 존재합니다', 409)
    }
    throw err
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string; optionId: string; batchId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, optionId, batchId } = await params

  // Space 격리 검증
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  const option = await prisma.invProductOption.findFirst({
    where: { id: optionId, productId },
    select: { id: true },
  })
  if (!option) return errorResponse('옵션을 찾을 수 없습니다', 404)

  const existing = await prisma.productionBatch.findFirst({
    where: { id: batchId, optionId },
    select: { id: true },
  })
  if (!existing) return errorResponse('생산차수를 찾을 수 없습니다', 404)

  await prisma.productionBatch.delete({ where: { id: batchId } })

  return new NextResponse(null, { status: 204 })
}
