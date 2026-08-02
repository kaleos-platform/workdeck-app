import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// 삭제: 분류 규칙 제거
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const { id } = await params

  const existing = await prisma.finClassRule.findFirst({
    where: { id, spaceId },
    select: { id: true },
  })
  if (!existing) return errorResponse('분류 규칙을 찾을 수 없습니다', 404)

  await prisma.finClassRule.delete({ where: { id } })

  // 삭제된 규칙으로 자동분류된 스테이징(DRAFT) 행을 미분류로 되돌린다.
  // (스테이징 GET이 남은 규칙으로 라이브 재제안하므로 별도 재분류 불필요.)
  // memo는 사용자 편집분과 구분 불가하므로 보존.
  const reset = await prisma.finStagedRow.updateMany({
    where: { spaceId, matchedRuleId: id, import: { status: 'DRAFT' } },
    data: { classStatus: 'UNCLASSIFIED', categoryId: null, matchedRuleId: null },
  })

  return NextResponse.json({ ok: true, resetRows: reset.count })
}
