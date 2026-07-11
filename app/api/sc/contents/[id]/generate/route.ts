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

  // 맥락 수집 — 페르소나/상품 정보는 ideationId 를 통해 lookup (Content 에 직접 FK 없음)
  const [brand, ideation] = await Promise.all([
    prisma.brandProfile.findUnique({
      where: { spaceId: resolved.space.id },
      select: { toneOfVoice: true },
    }),
    content.ideationId
      ? prisma.ideation.findUnique({
          where: { id: content.ideationId },
          select: {
            ideas: true,
            persona: { select: { name: true } },
            products: { include: { product: { select: { name: true } } } },
          },
        })
      : null,
  ])

  const ideas = (Array.isArray(ideation?.ideas) ? ideation?.ideas : []) as IdeaItem[]
  const chosen = content.ideaIndex != null ? ideas[content.ideaIndex] : undefined

  // 상품명 — 아이데이션에 연결된 첫 번째 상품
  const productName = ideation?.products?.[0]?.product?.name ?? null
  const personaName = ideation?.persona?.name ?? null

  const built = buildSectionFillPrompt({
    sectionLabel: parsed.data.sectionLabel,
    sectionKind: parsed.data.sectionKind,
    sectionGuidance: parsed.data.sectionGuidance ?? null,
    constraints: parsed.data.constraints,
    additionalInstruction: parsed.data.additionalInstruction ?? null,
    context: {
      productName,
      personaName,
      ideaTitle: chosen?.title ?? null,
      ideaAngle: chosen?.angle ?? null,
      ideaKeyPoints: chosen?.keyPoints ?? null,
      brandTone: (brand?.toneOfVoice as string[] | null) ?? null,
      brandForbidden: null,
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
    // 실패 로그 기록 — generate-text 라우트와 동일 패턴
    try {
      await prisma.textGenerationLog.create({
        data: {
          spaceId: resolved.space.id,
          userId: resolved.user.id,
          provider: 'unknown',
          responseFormat: 'text',
          status: 'FAILED',
          errorMessage: message.slice(0, 500),
        },
      })
    } catch {
      // 로그 기록 실패는 응답에 영향 없음
    }
    return errorResponse('섹션 생성에 실패했습니다', 502, { detail: message })
  }
}
