import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { updateTemplateSchema } from '@/lib/validations/hiring-posts'

type Params = { params: Promise<{ id: string }> }

// 템플릿 상세(블록 목록) 조회 — 불러오기 다이얼로그 미리보기용.
// 조회 스코프는 apply-template 과 동일: 소유 space 템플릿 OR isSample 공용 템플릿.
export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const template = await prisma.hiringDetailTemplate.findFirst({
    where: { id, OR: [{ spaceId: resolved.space.id }, { isSample: true }] },
    select: {
      id: true,
      name: true,
      isSample: true,
      contents: {
        where: { sourceType: 'DETAIL_TEMPLATE' },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          contentType: true,
          title: true,
          data: true,
          imagePath: true,
          sortOrder: true,
        },
      },
    },
  })
  if (!template) return errorResponse('템플릿을 찾을 수 없습니다', 404)

  const { contents, ...meta } = template
  return NextResponse.json({ template: meta, contents })
}

// 템플릿 이름 변경
export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const existing = await prisma.hiringDetailTemplate.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('템플릿을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = updateTemplateSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const template = await prisma.hiringDetailTemplate.update({
    where: { id },
    data: { name: parsed.data.name },
  })
  return NextResponse.json({ template })
}

// 템플릿 삭제
export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const existing = await prisma.hiringDetailTemplate.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('템플릿을 찾을 수 없습니다', 404)

  await prisma.hiringDetailTemplate.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
