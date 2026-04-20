import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string; optionId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, optionId } = await params

  const option = await prisma.invProductOption.findFirst({
    where: {
      id: optionId,
      productId,
      product: { spaceId: resolved.space.id },
    },
    select: { id: true },
  })
  if (!option) return errorResponse('옵션을 찾을 수 없습니다', 404)

  let body: { name?: string; sku?: string | null }
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 본문입니다', 400)
  }

  const data: { name?: string; sku?: string | null } = {}

  if (body.name !== undefined) {
    const trimmed = body.name.trim()
    if (!trimmed) return errorResponse('옵션명은 비어 있을 수 없습니다', 400)
    data.name = trimmed
  }

  if (body.sku !== undefined) {
    data.sku = body.sku === null || body.sku === '' ? null : body.sku.trim()
  }

  if (Object.keys(data).length === 0) {
    return errorResponse('변경할 필드가 없습니다', 400)
  }

  const updated = await prisma.invProductOption.update({
    where: { id: optionId },
    data,
    select: { id: true, name: true, sku: true, updatedAt: true },
  })

  return NextResponse.json(updated)
}
