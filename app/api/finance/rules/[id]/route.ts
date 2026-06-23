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

  return NextResponse.json({ ok: true })
}
