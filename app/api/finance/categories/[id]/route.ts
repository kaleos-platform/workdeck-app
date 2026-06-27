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
  const { name, alias, groupLabel, isActive, parentId, code } = body as {
    name?: string
    alias?: string
    groupLabel?: string
    isActive?: boolean
    /** 상위 대분류 이동(같은 타입 내에서만) */
    parentId?: string
    /** 회계용 내보내기 단계의 K-IFRS 매핑 코드 */
    code?: string | null
  }

  // spaceId 소유 검증
  const existing = await prisma.finCategory.findFirst({
    where: { id, spaceId },
    select: { id: true, isSystem: true, type: true },
  })
  if (!existing) return errorResponse('계정과목을 찾을 수 없습니다', 404)

  // 보호된 계정(루트·이체 항목)은 name 변경 금지
  if (existing.isSystem && name !== undefined) {
    return errorResponse('이 계정과목은 이름을 변경할 수 없습니다', 400)
  }

  // 상위 대분류 이동 검증: 같은 타입 + 대분류(루트 아님) + 자기참조 금지
  if (parentId !== undefined) {
    if (parentId === id) return errorResponse('자기 자신을 상위로 지정할 수 없습니다', 400)
    const newParent = await prisma.finCategory.findFirst({
      where: { id: parentId, spaceId },
      select: { id: true, type: true, parentId: true },
    })
    if (!newParent) return errorResponse('상위 대분류를 찾을 수 없습니다', 400)
    if (newParent.type !== existing.type) {
      return errorResponse('같은 구분(수입/지출) 내 대분류로만 이동할 수 있습니다', 400)
    }
    if (newParent.parentId === null) {
      return errorResponse('대분류 아래로만 이동할 수 있습니다', 400)
    }
  }

  try {
    const category = await prisma.finCategory.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(alias !== undefined && { alias }),
        ...(groupLabel !== undefined && { groupLabel }),
        ...(isActive !== undefined && { isActive }),
        ...(parentId !== undefined && { parentId }),
        ...(code !== undefined && { code: code && code.trim() ? code.trim() : null }),
      },
    })
    return NextResponse.json({ category })
  } catch (e: unknown) {
    const err = e as { code?: string }
    if (err?.code === 'P2002') {
      return errorResponse('이동/변경 대상에 같은 이름의 항목이 이미 있습니다', 409)
    }
    throw e
  }
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
