import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  let body: { name?: string; sku?: string }
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 본문입니다', 400)
  }

  const name = body.name?.trim()
  if (!name) return errorResponse('옵션명은 필수입니다', 400)

  const option = await prisma.invProductOption.create({
    data: {
      productId,
      name,
      sku: body.sku?.trim() || null,
    },
    select: { id: true, name: true, sku: true, createdAt: true },
  })

  return NextResponse.json(option, { status: 201 })
}
