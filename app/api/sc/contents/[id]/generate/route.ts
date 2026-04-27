// POST /api/sc/contents/[id]/generate — 섹션 1개에 AI 본문 주입.
// Body: { sectionKey, sectionLabel, sectionKind, sectionGuidance?, constraints?, additionalInstruction? }
// 응답: { content: string }  — 호출자가 TipTap 에디터에 삽입/치환.
// doc 저장은 이 API 가 담당하지 않음 (에디터 쪽 낙관적 업데이트 유지).

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { contentGenerateSectionSchema } from '@/lib/sc/schemas'
import { generateTextWithFallback } from '@/lib/ai/providers'
import { buildSectionFillPrompt } from '@/lib/sc/section-prompts'
import type { IdeaItem } from '@/lib/sc/ideation'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  const content = await prisma.content.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: {
      // product/persona 는 FK optional — 정보만 가져오려면 수동 join.
    },
  })
  if (!content) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = contentGenerateSectionSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // 맥락 수집
  const [product, persona, brand, ideation] = await Promise.all([
    content.productId
      ? prisma.b2BProduct.findUnique({
          where: { id: content.productId },
          select: { name: true },
        })
      : null,
    content.personaId
      ? prisma.persona.findUnique({ where: { id: content.personaId }, select: { name: true } })
      : null,
    prisma.brandProfile.findUnique({
      where: { spaceId: resolved.space.id },
      select: { toneOfVoice: true, forbiddenPhrases: true },
    }),
    content.ideationId
      ? prisma.contentIdea.findUnique({
          where: { id: content.ideationId },
          select: { ideas: true },
        })
      : null,
  ])

  const ideas = (Array.isArray(ideation?.ideas) ? ideation?.ideas : []) as IdeaItem[]
  const chosen = content.ideaIndex != null ? ideas[content.ideaIndex] : undefined

  const built = buildSectionFillPrompt({
    sectionLabel: parsed.data.sectionLabel,
    sectionKind: parsed.data.sectionKind,
    sectionGuidance: parsed.data.sectionGuidance ?? null,
    constraints: parsed.data.constraints,
    additionalInstruction: parsed.data.additionalInstruction ?? null,
    context: {
      productName: product?.name ?? null,
      personaName: persona?.name ?? null,
      ideaTitle: chosen?.title ?? null,
      ideaAngle: chosen?.angle ?? null,
      ideaKeyPoints: chosen?.keyPoints ?? null,
      brandTone: (brand?.toneOfVoice as string[] | null) ?? null,
      brandForbidden: (brand?.forbiddenPhrases as string[] | null) ?? null,
    },
  })

  try {
    const { result, providerName } = await generateTextWithFallback({
      system: built.system,
      messages: built.messages,
      responseFormat: 'text',
      maxTokens: 800,
      temperature: 0.7,
    })

    await prisma.textGenerationLog.create({
      data: {
        spaceId: resolved.space.id,
        userId: resolved.user.id,
        provider: providerName,
        model: result.model ?? null,
        responseFormat: 'text',
        status: 'SUCCEEDED',
        contentPreview: result.content.slice(0, 500),
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        latencyMs: result.latencyMs,
      },
    })

    return NextResponse.json({
      sectionKey: parsed.data.sectionKey,
      content: result.content.trim(),
      provider: providerName,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return errorResponse('섹션 생성에 실패했습니다', 502, { detail: message })
  }
}
