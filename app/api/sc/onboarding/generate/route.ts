import { NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { generateTextWithFallback } from '@/lib/ai/providers'
import { onboardingDraftSchema, type OnboardingDraft } from '@/lib/sc/onboarding/schemas'
import { ONBOARDING_SYSTEM_PROMPT, buildOnboardingUserPrompt } from '@/lib/sc/onboarding/prompts'

export const maxDuration = 120

function parseDraft(content: string): OnboardingDraft | null {
  // 모델이 코드펜스로 감싸는 경우 방어
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    const parsed = onboardingDraftSchema.safeParse(JSON.parse(stripped))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function POST() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const resources = await prisma.scOnboardingResource.findMany({
    where: { spaceId, status: 'DONE', extractedText: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { sourceUrl: true, fileName: true, extractedText: true },
  })
  if (resources.length === 0) {
    return errorResponse('분석할 리소스가 없습니다. URL 또는 문서를 먼저 등록하세요', 400)
  }

  await prisma.salesContentOnboarding.upsert({
    where: { spaceId },
    create: { spaceId, draftStatus: 'GENERATING' },
    update: { draftStatus: 'GENERATING' },
  })

  const userPrompt = buildOnboardingUserPrompt(
    resources.map((r) => ({
      label: r.sourceUrl ?? r.fileName ?? '자료',
      text: r.extractedText ?? '',
    }))
  )

  try {
    let draft: OnboardingDraft | null = null
    let providerName = 'unknown'
    let model: string | null | undefined
    let contentPreview = ''

    // JSON 파싱/검증 실패 시 1회 재시도
    for (let attempt = 0; attempt < 2 && !draft; attempt++) {
      const { result, providerName: pn } = await generateTextWithFallback({
        system: ONBOARDING_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        responseFormat: 'json',
        maxTokens: 4096,
        temperature: 0.3,
      })
      providerName = pn
      model = result.model
      contentPreview = result.content.slice(0, 500)
      draft = parseDraft(result.content)
    }

    await prisma.textGenerationLog.create({
      data: {
        spaceId,
        userId: resolved.user.id,
        provider: providerName,
        model: model ?? null,
        responseFormat: 'json',
        status: draft ? 'SUCCEEDED' : 'FAILED',
        contentPreview,
        errorMessage: draft ? null : '온보딩 초안 JSON 검증 실패',
      },
    })

    if (!draft) {
      await prisma.salesContentOnboarding.update({
        where: { spaceId },
        data: { draftStatus: 'FAILED' },
      })
      return errorResponse('초안 생성 결과를 해석하지 못했습니다. 다시 시도해주세요', 502)
    }

    const onboarding = await prisma.salesContentOnboarding.update({
      where: { spaceId },
      data: { draft: draft as never, draftStatus: 'READY' },
    })
    return NextResponse.json({ draft: onboarding.draft, draftStatus: onboarding.draftStatus })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.salesContentOnboarding.update({
      where: { spaceId },
      data: { draftStatus: 'FAILED' },
    })
    await prisma.textGenerationLog.create({
      data: {
        spaceId,
        userId: resolved.user.id,
        provider: 'unknown',
        responseFormat: 'json',
        status: 'FAILED',
        errorMessage: message.slice(0, 500),
      },
    })
    return errorResponse('초안 생성에 실패했습니다', 502, { detail: message })
  }
}
