/**
 * PATCH  /api/finance/mapping-presets/[id]  — 규칙 이름 변경
 * DELETE /api/finance/mapping-presets/[id]  — 규칙 삭제
 *
 * 규칙(매핑 프리셋)은 FinImport/FinStagedRow가 참조하지 않으므로 연쇄 정리가 없다.
 * 삭제하면 다음 업로드부터 헤더 자동 매핑으로 폴백한다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id
  const { id } = await params

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return errorResponse('규칙 이름이 필요합니다', 400)
  if (name.length > 100) return errorResponse('규칙 이름은 100자 이하여야 합니다', 400)

  const preset = await prisma.finMappingPreset.findFirst({
    where: { id, spaceId },
    select: { id: true },
  })
  if (!preset) return errorResponse('규칙을 찾을 수 없습니다', 404)

  const dup = await prisma.finMappingPreset.findFirst({
    where: { spaceId, name, id: { not: id } },
    select: { id: true },
  })
  if (dup) return errorResponse('같은 이름의 규칙이 이미 있습니다', 400)

  const updated = await prisma.finMappingPreset.update({
    where: { id },
    data: { name },
    select: {
      id: true,
      name: true,
      institution: true,
      kind: true,
      mapping: true,
      defaultAccountId: true,
      dateFormat: true,
      updatedAt: true,
    },
  })
  return NextResponse.json({ preset: updated })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id
  const { id } = await params

  const preset = await prisma.finMappingPreset.findFirst({
    where: { id, spaceId },
    select: { id: true },
  })
  if (!preset) return errorResponse('규칙을 찾을 수 없습니다', 404)

  await prisma.finMappingPreset.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
