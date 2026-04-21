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
  })
  if (!group) return errorResponse('그룹을 찾을 수 없습니다', 404)

  // Unlink products first (set groupId to null), then delete group
  await prisma.$transaction([
    prisma.invProduct.updateMany({
      where: { groupId },
      data: { groupId: null },
    }),
    prisma.invProductGroup.delete({ where: { id: groupId } }),
  ])

  return NextResponse.json({ success: true })
}
