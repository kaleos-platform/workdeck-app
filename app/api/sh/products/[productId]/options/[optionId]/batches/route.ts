import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productionBatchSchema } from '@/lib/sh/schemas'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string; optionId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, optionId } = await params

  // 상품 → 옵션 소속 검증 (Space 격리)
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

  const batches = await prisma.productionBatch.findMany({
    where: { optionId },
    orderBy: { producedAt: 'desc' },
  })

  return NextResponse.json({ batches })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string; optionId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, optionId } = await params

  // 상품 → 옵션 소속 검증 (Space 격리)
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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = productionBatchSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const { batchNo, producedAt, unitCost, quantity, memo } = parsed.data

  try {
    const batch = await prisma.productionBatch.create({
      data: {
        optionId,
        batchNo,
        producedAt: new Date(producedAt),
        unitCost,
        quantity: quantity ?? null,
        memo: memo ?? null,
      },
    })
    return NextResponse.json({ batch }, { status: 201 })
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
