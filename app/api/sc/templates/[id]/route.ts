import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { templateInputSchema } from '@/lib/sc/schemas'
import { sectionsSchemaForKind, type TemplateSectionsShape } from '@/lib/sc/template-engine'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const template = await prisma.template.findFirst({
    where: {
      id,
      OR: [{ spaceId: null, isSystem: true }, { spaceId: resolved.space.id }],
    },
  })
  if (!template) return errorResponse('템플릿을 찾을 수 없습니다', 404)

  return NextResponse.json({ template })
}

// PATCH: 사용자 소유 템플릿만 수정 가능 (isSystem=true 는 403).
// body.cloneFrom=true 이면 시스템 템플릿을 복제해서 새 사용자 템플릿 생성 (사이드이펙트).
export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const wantsClone = (body as { cloneFrom?: boolean } | null)?.cloneFrom === true

  const existing = await prisma.template.findUnique({ where: { id } })
  if (!existing) return errorResponse('템플릿을 찾을 수 없습니다', 404)

  // 조회 범위 제한
  const isSystem = existing.spaceId === null && existing.isSystem
  const isOwned = existing.spaceId === resolved.space.id
  if (!isSystem && !isOwned) return errorResponse('권한이 없습니다', 403)

  if (wantsClone) {
    if (!isSystem) return errorResponse('복제는 시스템 템플릿에서만 가능합니다', 400)
    const newSlug = `${existing.slug}-copy-${Date.now().toString(36)}`
    const cloned = await prisma.template.create({
      data: {
        spaceId: resolved.space.id,
        name: `${existing.name} (복사본)`,
        slug: newSlug,
        kind: existing.kind,
        sections: existing.sections as TemplateSectionsShape,
        isSystem: false,
        isActive: true,
      },
    })
    return NextResponse.json({ template: cloned }, { status: 201 })
  }

  if (isSystem) return errorResponse('시스템 템플릿은 직접 수정할 수 없습니다', 403)

  const parsed = templateInputSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  let sectionsOut = undefined
  if (parsed.data.sections !== undefined) {
    const sectionsParsed = sectionsSchemaForKind(parsed.data.kind ?? existing.kind).safeParse(
      parsed.data.sections
    )
    if (!sectionsParsed.success) {
      return errorResponse('sections 구조가 올바르지 않습니다', 400, {
        errors: sectionsParsed.error.flatten(),
      })
    }
    sectionsOut = sectionsParsed.data
  }

  try {
    const updated = await prisma.template.update({
      where: { id },
      data: {
        name: parsed.data.name ?? undefined,
        slug: parsed.data.slug ?? undefined,
        kind: parsed.data.kind ?? undefined,
        sections: sectionsOut,
        isActive: parsed.data.isActive ?? undefined,
      },
    })
    return NextResponse.json({ template: updated })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return errorResponse('이미 동일한 slug 의 템플릿이 존재합니다', 409)
    }
    throw err
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.template.findUnique({ where: { id } })
  if (!existing) return errorResponse('템플릿을 찾을 수 없습니다', 404)
  if (existing.spaceId === null && existing.isSystem) {
    return errorResponse('시스템 템플릿은 삭제할 수 없습니다', 403)
  }
  if (existing.spaceId !== resolved.space.id) {
    return errorResponse('권한이 없습니다', 403)
  }
  await prisma.template.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
