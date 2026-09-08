import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { generateTextForSpace, AiNotConfiguredError, ByokKeyError } from '@/lib/ai/resolve'
import { TextQuotaExceededError } from '@/lib/ai/credit'
import { parseCollectedPage, pageKind } from '@/lib/sc/onboarding/crawl'
import { readProductAnalysis, uniqueDraftProducts } from '@/lib/sc/onboarding/analysis'
import {
  extractSalesProduct,
  readProductPage,
  EmptyProductSourceError,
} from '@/lib/sc/product-import/extract'
import { onboardingDraftSchema, type OnboardingDraft } from '@/lib/sc/onboarding/schemas'
import { ONBOARDING_SYSTEM_PROMPT, buildOnboardingUserPrompt } from '@/lib/sc/onboarding/prompts'

export const maxDuration = 180

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

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id
  const body = await req.json().catch(() => ({}))
  const input = z.object({ audience: z.string().trim().max(200).default('') }).safeParse(body)
  if (!input.success) return errorResponse('고객군은 200자 이내로 입력해주세요', 400)
  const audience = input.data.audience

  const resources = await prisma.scOnboardingResource.findMany({
    where: { spaceId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      sourceUrl: true,
      fileName: true,
      extractedText: true,
      status: true,
      errorMessage: true,
    },
  })
  if (resources.some((r) => r.status === 'PENDING'))
    return errorResponse('자료 수집을 먼저 완료해주세요', 409)
  const usable = resources
    .filter((r) => r.status === 'DONE' && r.extractedText)
    .map((r) => ({
      ...r,
      page: parseCollectedPage(r.extractedText!) ?? {
        version: 1 as const,
        kind: r.sourceUrl ? pageKind(r.sourceUrl) : ('document' as const),
        title: r.sourceUrl ?? r.fileName ?? '자료',
        text: r.extractedText!,
        imageUrls: [] as string[],
        sourceUrl: r.sourceUrl ?? undefined,
      },
    }))
  if (usable.length === 0) {
    return errorResponse('분석할 리소스가 없습니다. URL 또는 문서를 먼저 등록하세요', 400)
  }

  await prisma.salesContentOnboarding.upsert({
    where: { spaceId },
    create: { spaceId, draftStatus: 'GENERATING' },
    update: { draftStatus: 'GENERATING' },
  })

  try {
    const productResources = usable.filter((r) => r.page.kind === 'product')
    const products = productResources.flatMap((r) => {
      const cached = readProductAnalysis(r.extractedText!, audience)
      return cached ? [cached] : []
    })
    const nextProduct = productResources.find(
      (r) => !readProductAnalysis(r.extractedText!, audience)
    )
    if (nextProduct) {
      try {
        const source = parseCollectedPage(nextProduct.extractedText!)
          ? nextProduct.page
          : await readProductPage(nextProduct.sourceUrl!)
        const result = await extractSalesProduct(spaceId, source, audience)
        await prisma.scOnboardingResource.updateMany({
          where: { id: nextProduct.id, spaceId, extractedText: nextProduct.extractedText },
          data: {
            extractedText: JSON.stringify({
              ...nextProduct.page,
              analysis: { audience, draft: result.draft },
            }),
          },
        })
        await prisma.textGenerationLog.create({
          data: {
            spaceId,
            userId: resolved.user.id,
            provider: result.providerName,
            model: result.model ?? null,
            responseFormat: 'json',
            status: 'SUCCEEDED',
            contentPreview: result.draft.name,
          },
        })
        return NextResponse.json({
          done: false,
          processed: result.draft.name,
          progress: { completed: products.length + 1, total: productResources.length },
        })
      } catch (error) {
        if (error instanceof EmptyProductSourceError) {
          await prisma.scOnboardingResource.updateMany({
            where: { id: nextProduct.id, spaceId },
            data: { status: 'FAILED', errorMessage: error.message },
          })
        }
        throw error
      }
    }

    // 개별 상품은 이미 분석되어 있다. 브랜드/문서/사례에 입력 예산을 우선 배분한다.
    const context = usable.filter((r) => r.page.kind !== 'product' && r.page.kind !== 'catalog')
    const sourceTexts = (context.length ? context : usable).map((r) => ({
      label: r.sourceUrl ?? r.fileName ?? '자료',
      text: r.page.text,
    }))
    const userPrompt = buildOnboardingUserPrompt(sourceTexts, audience)
    let draft: OnboardingDraft | null = null
    let providerName = 'unknown'
    let model: string | null | undefined
    let contentPreview = ''

    // JSON 파싱/검증 실패 시 1회 재시도
    for (let attempt = 0; attempt < 2 && !draft; attempt++) {
      const { result, providerName: pn } = await generateTextForSpace(spaceId, {
        system: ONBOARDING_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        responseFormat: 'json',
        maxTokens: 8000,
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

    draft.products = uniqueDraftProducts([...products, ...draft.products])
    draft.audience = audience
    draft.warnings = resources
      .filter((r) => r.status === 'FAILED' || r.errorMessage)
      .map((r) => `${r.sourceUrl ?? r.fileName}: ${r.errorMessage ?? '자료 수집 실패'}`)

    const onboarding = await prisma.salesContentOnboarding.update({
      where: { spaceId },
      data: { draft: draft as never, draftStatus: 'READY' },
    })
    return NextResponse.json({
      done: true,
      draft: onboarding.draft,
      draftStatus: onboarding.draftStatus,
    })
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
    if (error instanceof AiNotConfiguredError || error instanceof ByokKeyError)
      return errorResponse(error.message, 409, { settingsPath: '/settings/ai' })
    if (error instanceof TextQuotaExceededError)
      return errorResponse('이번 달 AI 사용량을 모두 사용했습니다', 429, {
        settingsPath: '/settings/ai',
      })
    return errorResponse(
      error instanceof EmptyProductSourceError
        ? error.message
        : '초안 생성에 실패했습니다. AI 설정을 확인한 뒤 다시 시도해주세요',
      502
    )
  }
}
