import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// 수정: alias/groupLabel/isActive는 isSystem 무관하게 허용, name은 isSystem=true 금지
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { name, alias, groupLabel, isActive } = body as {
    name?: string
    alias?: string
    groupLabel?: string
    isActive?: boolean
  }

  // spaceId 소유 검증
  const existing = await prisma.finCategory.findFirst({
    where: { id, spaceId },
    select: { id: true, isSystem: true },
  })
  if (!existing) return errorResponse('계정과목을 찾을 수 없습니다', 404)

  // 표준 계정과목은 name 변경 금지
  if (existing.isSystem && name !== undefined) {
    return errorResponse('표준 계정과목은 이름을 변경할 수 없습니다', 400)
  }

  const category = await prisma.finCategory.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(alias !== undefined && { alias }),
      ...(groupLabel !== undefined && { groupLabel }),
      ...(isActive !== undefined && { isActive }),
    },
  })

  return NextResponse.json({ category })
}

// 삭제: isSystem=true 금지, children은 cascade, transactions는 SetNull
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const { id } = await params

  const existing = await prisma.finCategory.findFirst({
    where: { id, spaceId },
    select: { id: true, isSystem: true },
  })
  if (!existing) return errorResponse('계정과목을 찾을 수 없습니다', 404)
  if (existing.isSystem) return errorResponse('표준 계정과목은 삭제할 수 없습니다', 400)

  await prisma.finCategory.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
