import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { groupId } = await params

  const group = await prisma.invProductGroup.findFirst({
    where: { id: groupId, spaceId: resolved.space.id },
  })
  if (!group) return errorResponse('그룹을 찾을 수 없습니다', 404)

  let body: { name?: string }
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 본문입니다', 400)
  }

  const name = body.name?.trim()
  if (!name) return errorResponse('그룹명은 필수입니다', 400)

  // Check duplicate name
  const conflict = await prisma.invProductGroup.findFirst({
    where: { spaceId: resolved.space.id, name, id: { not: groupId } },
  })
  if (conflict) return errorResponse('이미 존재하는 그룹명입니다', 409)

  const updated = await prisma.invProductGroup.update({
    where: { id: groupId },
    data: { name },
  })

  return NextResponse.json({ group: updated })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { groupId } = await params

  const group = await prisma.invProductGroup.findFirst({
    where: { id: groupId, spaceId: resolved.space.id },
    include: { _count: { select: { products: true } } },
  })
  if (!group) return errorResponse('그룹을 찾을 수 없습니다', 404)

  // groupId non-null 제약 — 상품이 연결된 그룹은 삭제 불가
  if (group._count.products > 0) {
    return errorResponse(
      `이 카테고리에 상품 ${group._count.products}개가 연결되어 있어 삭제할 수 없습니다. 상품을 다른 카테고리로 이동 후 삭제하세요.`,
      409
    )
  }

  await prisma.invProductGroup.delete({ where: { id: groupId } })

  return NextResponse.json({ success: true })
}
