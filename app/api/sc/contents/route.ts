import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { contentCreateSchema } from '@/lib/sc/schemas'
import { renderSkeleton, type TemplateSectionsShape } from '@/lib/sc/template-engine'
import type { IdeaItem } from '@/lib/sc/ideation'

// GET: Content 목록. 상태 필터(?status=DRAFT) 지원.
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? undefined

  const contents = await prisma.content.findMany({
    where: {
      spaceId: resolved.space.id,
      ...(status ? { status: status as never } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      title: true,
      status: true,
      channelId: true,
      scheduledAt: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      channel: { select: { id: true, name: true, platform: true } },
    },
  })

  return NextResponse.json({ contents })
}

// POST: 새 Content 생성. template + idea 가 있으면 skeleton 으로 doc 초기화.
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = contentCreateSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // 초기 doc — 템플릿이 있으면 skeleton, 없으면 빈 문서.
  let initialDoc: unknown = { type: 'doc', content: [] }
  if (parsed.data.templateId) {
    const template = await prisma.template.findFirst({
      where: {
        id: parsed.data.templateId,
        OR: [{ spaceId: null, isSystem: true }, { spaceId: resolved.space.id }],
      },
    })
    if (template) {
      initialDoc = renderSkeleton(template.kind, template.sections as TemplateSectionsShape).doc
    }
  }

  // idea 가 있으면 title 자동 채움 (없으면 입력된 title 사용).
  let derivedTitle = parsed.data.title
  if (parsed.data.ideationId && parsed.data.ideaIndex != null) {
    const ideation = await prisma.contentIdea.findFirst({
      where: { id: parsed.data.ideationId, spaceId: resolved.space.id },
      select: { ideas: true },
    })
    const ideas = (Array.isArray(ideation?.ideas) ? ideation?.ideas : []) as IdeaItem[]
    const chosen = ideas[parsed.data.ideaIndex]
    if (chosen?.title) derivedTitle = chosen.title
  }

  const created = await prisma.content.create({
    data: {
      spaceId: resolved.space.id,
      userId: resolved.user.id,
      title: derivedTitle,
      status: 'DRAFT',
      templateId: parsed.data.templateId ?? null,
      ideationId: parsed.data.ideationId ?? null,
      ideaIndex: parsed.data.ideaIndex ?? null,
      productId: parsed.data.productId ?? null,
      personaId: parsed.data.personaId ?? null,
      channelId: parsed.data.channelId ?? null,
      doc: initialDoc as never,
    },
  })

  return NextResponse.json({ content: created }, { status: 201 })
}
