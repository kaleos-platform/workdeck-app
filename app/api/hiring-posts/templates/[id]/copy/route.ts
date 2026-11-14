import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { copyTemplateSchema } from '@/lib/validations/hiring-posts'
import { templateAccessScope, templateContentScope } from '@/lib/hiring/template-scope'

type Params = { params: Promise<{ id: string }> }

const NAME_MAX = 200
const COPY_SUFFIX = ' (복사)'

// 템플릿을 내 템플릿으로 복사 — 워크덱 제공 템플릿과 내 템플릿 모두 원본이 될 수 있다.
export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error
  const { space } = resolved
  const { id } = await params

  // 본문은 선택 — 비어 있으면 기본 이름을 쓴다.
  let body: unknown = {}
  try {
    const text = await req.text()
    if (text.trim()) body = JSON.parse(text)
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = copyTemplateSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const source = await prisma.hiringDetailTemplate.findFirst({
    where: { id, ...templateAccessScope(space.id) },
    select: {
      name: true,
      imagePath: true,
      contents: {
        where: templateContentScope(space.id),
        orderBy: { sortOrder: 'asc' },
        select: { contentType: true, title: true, data: true, imagePath: true, sortOrder: true },
      },
    },
  })
  if (!source) return errorResponse('템플릿을 찾을 수 없습니다', 404)

  // 접미사를 붙인 뒤 길이 제한에 맞게 원본 이름을 자른다.
  const name =
    parsed.data.name ??
    `${source.name.trim().slice(0, NAME_MAX - COPY_SUFFIX.length)}${COPY_SUFFIX}`

  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.hiringDetailTemplate.create({
      data: { spaceId: space.id, isSample: false, name, imagePath: source.imagePath },
      select: { id: true, name: true, updatedAt: true },
    })
    if (source.contents.length > 0) {
      await tx.hiringContent.createMany({
        data: source.contents.map((c) => ({
          spaceId: space.id,
          sourceType: 'DETAIL_TEMPLATE' as const,
          templateId: created.id,
          contentType: c.contentType,
          title: c.title,
          data: (c.data ?? undefined) as Prisma.InputJsonValue | undefined,
          imagePath: c.imagePath,
          sortOrder: c.sortOrder,
        })),
      })
    }
    return created
  })

  return NextResponse.json(
    { template: { ...template, blockCount: source.contents.length } },
    { status: 201 }
  )
}
