import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// 프리셋 삭제 — 본인 space의 preset만 삭제 가능
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  const preset = await prisma.delColumnMappingPreset.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!preset) return errorResponse('프리셋을 찾을 수 없습니다', 404)

  await prisma.delColumnMappingPreset.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
