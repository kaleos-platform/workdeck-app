import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { templateInputSchema } from '@/lib/sc/schemas'
import { sectionsSchemaForKind } from '@/lib/sc/template-engine'

// GET: 시스템 템플릿(spaceId=null) + 현재 Space 의 사용자 템플릿 통합 목록.
export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const templates = await prisma.template.findMany({
    where: {
      OR: [{ spaceId: null, isSystem: true }, { spaceId: resolved.space.id }],
      isActive: true,
    },
    orderBy: [{ isSystem: 'desc' }, { kind: 'asc' }, { name: 'asc' }],
  })
  return NextResponse.json({ templates })
}

// POST: 사용자 템플릿 생성.
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = templateInputSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const sectionsParsed = sectionsSchemaForKind(parsed.data.kind).safeParse(parsed.data.sections)
  if (!sectionsParsed.success) {
    return errorResponse('sections 구조가 올바르지 않습니다', 400, {
      errors: sectionsParsed.error.flatten(),
    })
  }

  const created = await prisma.template.create({
    data: {
      spaceId: resolved.space.id,
      name: parsed.data.name,
      kind: parsed.data.kind,
      sections: sectionsParsed.data,
      isSystem: false,
      isActive: parsed.data.isActive ?? true,
    },
  })
  return NextResponse.json({ template: created }, { status: 201 })
}
