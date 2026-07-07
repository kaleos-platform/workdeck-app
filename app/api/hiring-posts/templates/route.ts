import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { createTemplateSchema } from '@/lib/validations/hiring-posts'

// 상세 템플릿 목록
export async function GET() {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error

  const templates = await prisma.hiringDetailTemplate.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { contents: true } } },
  })
  return NextResponse.json({ templates })
}

// 공고 상세 블록을 템플릿으로 저장 (콘텐츠 복제)
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = createTemplateSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // 소스 공고 소속 검증 + 상세 블록 조회
  const posting = await prisma.hiringPosting.findFirst({
    where: { id: parsed.data.postingId, spaceId: resolved.space.id },
    select: {
      id: true,
      contents: {
        where: { sourceType: 'POSTING_DETAIL' },
        orderBy: { sortOrder: 'asc' },
        select: { contentType: true, data: true, imagePath: true, sortOrder: true },
      },
    },
  })
  if (!posting) return errorResponse('공고를 찾을 수 없습니다', 404)

  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.hiringDetailTemplate.create({
      data: {
        spaceId: resolved.space.id,
        name: parsed.data.name,
        imagePath: posting.contents[0]?.imagePath ?? null,
      },
    })
    if (posting.contents.length > 0) {
      await tx.hiringContent.createMany({
        data: posting.contents.map((c) => ({
          spaceId: resolved.space.id,
          sourceType: 'DETAIL_TEMPLATE' as const,
          templateId: created.id,
          contentType: c.contentType,
          data: (c.data ?? undefined) as Prisma.InputJsonValue | undefined,
          imagePath: c.imagePath,
          sortOrder: c.sortOrder,
        })),
      })
    }
    return created
  })

  return NextResponse.json({ template }, { status: 201 })
}
