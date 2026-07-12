import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { applyTemplateSchema } from '@/lib/validations/hiring-posts'

type Params = { params: Promise<{ id: string }> }

// 상세 템플릿을 공고에 적용 — 기존 POSTING_DETAIL 블록 전체 교체
export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = applyTemplateSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const posting = await prisma.hiringPosting.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!posting) return errorResponse('공고를 찾을 수 없습니다', 404)

  const template = await prisma.hiringDetailTemplate.findFirst({
    where: { id: parsed.data.templateId, spaceId: resolved.space.id },
    select: {
      id: true,
      contents: {
        where: { sourceType: 'DETAIL_TEMPLATE' },
        orderBy: { sortOrder: 'asc' },
        select: { contentType: true, data: true, imagePath: true, sortOrder: true },
      },
    },
  })
  if (!template) return errorResponse('템플릿을 찾을 수 없습니다', 404)

  await prisma.$transaction(async (tx) => {
    await tx.hiringContent.deleteMany({
      where: { postingId: id, sourceType: 'POSTING_DETAIL' },
    })
    if (template.contents.length > 0) {
      await tx.hiringContent.createMany({
        data: template.contents.map((c, i) => ({
          spaceId: resolved.space.id,
          sourceType: 'POSTING_DETAIL' as const,
          postingId: id,
          contentType: c.contentType,
          data: (c.data ?? undefined) as Prisma.InputJsonValue | undefined,
          imagePath: c.imagePath,
          sortOrder: i,
        })),
      })
    }
  })

  const contents = await prisma.hiringContent.findMany({
    where: { postingId: id, sourceType: 'POSTING_DETAIL' },
    orderBy: { sortOrder: 'asc' },
  })
  return NextResponse.json({ contents })
}
