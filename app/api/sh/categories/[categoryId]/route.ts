import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// PATCH /api/sh/categories/[categoryId]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { categoryId } = await params

  const category = await prisma.invProductGroup.findFirst({
    where: { id: categoryId, spaceId: resolved.space.id },
  })
  if (!category) return errorResponse('카테고리를 찾을 수 없습니다', 404)

  let body: { name?: string }
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 본문입니다', 400)
  }

  const name = body.name?.trim()
  if (!name) return errorResponse('카테고리명은 필수입니다', 400)
  if (name.length > 100) return errorResponse('카테고리명은 100자 이내여야 합니다', 400)

  // 중복 검사
  const conflict = await prisma.invProductGroup.findFirst({
    where: { spaceId: resolved.space.id, name, id: { not: categoryId } },
  })
  if (conflict) return errorResponse('이미 존재하는 카테고리명입니다', 409)

  const updated = await prisma.invProductGroup.update({
    where: { id: categoryId },
    data: { name },
  })

  return NextResponse.json({ category: updated })
}

// DELETE /api/sh/categories/[categoryId]
// 상품이 연결된 카테고리는 삭제 불가 (groupId non-null 제약)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { categoryId } = await params

  const category = await prisma.invProductGroup.findFirst({
    where: { id: categoryId, spaceId: resolved.space.id },
    include: { _count: { select: { products: true } } },
  })
  if (!category) return errorResponse('카테고리를 찾을 수 없습니다', 404)

  // groupId non-null 제약으로 인해 상품이 있으면 삭제 불가
  if (category._count.products > 0) {
    return errorResponse(
      `이 카테고리에 상품 ${category._count.products}개가 연결되어 있어 삭제할 수 없습니다. 상품을 다른 카테고리로 이동 후 삭제하세요.`,
      409
    )
  }

  await prisma.invProductGroup.delete({ where: { id: categoryId } })

  return new NextResponse(null, { status: 204 })
}
