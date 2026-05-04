import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { generateTextWithFallback } from '@/lib/ai/providers'
import {
  buildIdeationPrompt,
  type IdeationBrandCtx,
  type IdeationBuilderInput,
  type IdeationPersonaCtx,
  type IdeationProductCtx,
  type IdeationRule,
} from './prompts'

// ─── AI 응답 스키마 (JSON) ──────────────────────────────────────────────────

export const ideaItemSchema = z.object({
  title: z.string().min(1).max(200),
  hook: z.string().min(1).max(300),
  angle: z.string().min(1).max(400),
  keyPoints: z.array(z.string().min(1).max(300)).min(1).max(8),
  targetChannel: z.enum(['blog', 'social', 'cardnews']),
  reasoning: z.string().min(1).max(1000),
})

export const ideaListResponseSchema = z.object({
  ideas: z.array(ideaItemSchema).min(1).max(10),
})

export type IdeaItem = z.infer<typeof ideaItemSchema>

// ─── Orchestrator ──────────────────────────────────────────────────────────

export interface RunIdeationInput {
  spaceId: string
  userId: string
  // personaId 는 새 스키마에서 NOT NULL
  personaId: string
  // 상품은 0~N (M:N)
  productIds?: string[] | null
  targetKeywords?: string[] | null
  userPromptInput?: string | null
  count?: number
}

export interface RunIdeationSuccess {
  ok: true
  ideationId: string
  ideas: IdeaItem[]
  providerName: string
}

export interface RunIdeationFailure {
  ok: false
  code: 'AI_FAILURE' | 'PARSE_FAILURE' | 'NOT_CONFIGURED'
  message: string
  detail?: string
}

export type RunIdeationResult = RunIdeationSuccess | RunIdeationFailure

// Unit 13 에서 교체 — ImprovementRule 테이블에서 ACTIVE 규칙을 scope 매치로 조회.
async function loadActiveRules(params: {
  spaceId: string
  productIds?: string[] | null
  personaId?: string | null
}): Promise<IdeationRule[]> {
  const { loadActiveImprovementRules } = await import('./improvement')
  // improvement.ts 는 단일 productId 기대 — 첫 번째 상품 ID 만 전달 (MVP-1 단순화)
  return loadActiveImprovementRules({
    spaceId: params.spaceId,
    productId: params.productIds?.[0] ?? null,
    personaId: params.personaId,
  })
}

async function loadBuilderContext(input: RunIdeationInput): Promise<{
  products: IdeationProductCtx[]
  persona: IdeationPersonaCtx | null
  brand: IdeationBrandCtx | null
  rules: IdeationRule[]
}> {
  const [productsRaw, persona, brand, rules] = await Promise.all([
    input.productIds?.length
      ? prisma.product.findMany({
          where: { id: { in: input.productIds }, spaceId: input.spaceId },
          select: {
            id: true,
            name: true,
            oneLinerPitch: true,
            customFields: true,
          },
        })
      : [],
    prisma.persona.findFirst({
      where: { id: input.personaId, spaceId: input.spaceId },
      select: {
        id: true,
        name: true,
        jobTitle: true,
        industry: true,
        customFields: true,
      },
    }),
    prisma.brandProfile.findUnique({
      where: { spaceId: input.spaceId },
      select: {
        companyName: true,
        shortDescription: true,
        toneOfVoice: true,
        customFields: true,
      },
    }),
    loadActiveRules({
      spaceId: input.spaceId,
      productIds: input.productIds,
      personaId: input.personaId,
    }),
  ])

  // customFields: Json → Array<{key,value}> 안전 캐스팅
  const toCustomFields = (v: unknown): Array<{ key: string; value: string }> | null => {
    if (!Array.isArray(v)) return null
    return v as Array<{ key: string; value: string }>
  }

  const products: IdeationProductCtx[] = productsRaw.map((p) => ({
    id: p.id,
    name: p.name,
    oneLinerPitch: p.oneLinerPitch,
    customFields: toCustomFields(p.customFields),
  }))

  return {
    products,
    persona: persona
      ? {
          id: persona.id,
          name: persona.name,
          jobTitle: persona.jobTitle,
          industry: persona.industry,
          customFields: toCustomFields(persona.customFields),
        }
      : null,
    brand: brand
      ? {
          companyName: brand.companyName,
          shortDescription: brand.shortDescription,
          toneOfVoice: brand.toneOfVoice as string[] | null,
          customFields: toCustomFields(brand.customFields),
        }
      : null,
    rules,
  }
}

// 모델 응답에서 JSON 블록만 추출해 파싱. 마크다운 코드펜스가 섞인 경우 제거.
function parseIdeaJson(raw: string): { parsed: unknown; error?: string } {
  const trimmed = raw.trim()
  const unwrapped = stripCodeFence(trimmed)
  try {
    return { parsed: JSON.parse(unwrapped) }
  } catch (err) {
    return {
      parsed: null,
      error: err instanceof Error ? err.message : 'JSON parse error',
    }
  }
}

function stripCodeFence(s: string): string {
  const m = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(s.trim())
  return m ? m[1].trim() : s
}

export async function runIdeation(input: RunIdeationInput): Promise<RunIdeationResult> {
  const count = Math.min(Math.max(input.count ?? 5, 3), 10)
  const ctx = await loadBuilderContext(input)

  // buildIdeationPrompt 는 단일 product 를 받으므로 첫 번째만 전달 (MVP-1 단순화)
  const builderInput: IdeationBuilderInput = {
    product: ctx.products[0] ?? null,
    persona: ctx.persona,
    brand: ctx.brand,
    rules: ctx.rules,
    userPromptInput: input.userPromptInput ?? null,
    count,
  }

  const built = buildIdeationPrompt(builderInput)

  // 1회 재시도 — ACP 타임아웃/일시 실패 대응
  let attempt = 0
  let lastError: unknown
  while (attempt < 2) {
    attempt++
    try {
      const { result, providerName } = await generateTextWithFallback({
        system: built.system,
        messages: built.messages,
        responseFormat: 'json',
        maxTokens: 2048,
        temperature: 0.7,
      })

      const { parsed, error } = parseIdeaJson(result.content)
      if (error) {
        lastError = new Error(`JSON parse: ${error}`)
        continue
      }
      const validated = ideaListResponseSchema.safeParse(parsed)
      if (!validated.success) {
        lastError = new Error(`schema: ${validated.error.message}`)
        continue
      }

      // Ideation 생성 + IdeationProduct M:N rows 를 트랜잭션으로 저장
      const productIds = input.productIds?.filter(Boolean) ?? []
      const saved = await prisma.$transaction(async (tx) => {
        const ideation = await tx.ideation.create({
          data: {
            spaceId: input.spaceId,
            userId: input.userId,
            personaId: input.personaId,
            targetKeywords: (input.targetKeywords ?? []) as never,
            generatedBy: 'AI',
            ideas: validated.data.ideas as never,
            promptTraceHash: built.traceHash,
            ruleIdsSnapshot: built.ruleIds as never,
            providerName,
            providerModel: result.model ?? null,
            latencyMs: result.latencyMs,
          },
          select: { id: true },
        })
        if (productIds.length > 0) {
          await tx.ideationProduct.createMany({
            data: productIds.map((productId) => ({ ideationId: ideation.id, productId })),
            skipDuplicates: true,
          })
        }
        return ideation
      })

      return {
        ok: true,
        ideationId: saved.id,
        ideas: validated.data.ideas,
        providerName,
      }
    } catch (err) {
      lastError = err
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  const code = /not configured|구성되지 않|사용 가능한.*공급자가 구성되지/i.test(detail)
    ? 'NOT_CONFIGURED'
    : /JSON parse|schema/i.test(detail)
      ? 'PARSE_FAILURE'
      : 'AI_FAILURE'
  return {
    ok: false,
    code,
    message:
      code === 'NOT_CONFIGURED'
        ? '사용 가능한 AI 공급자가 없어 글감을 생성하지 못했습니다'
        : code === 'PARSE_FAILURE'
          ? 'AI 응답을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요'
          : '글감 생성에 실패했습니다',
    detail: detail.slice(0, 500),
  }
}

// 사용자 수동 작성 — AI 호출 없이 사용자가 직접 입력한 ideas 저장.
export async function saveUserIdeation(input: {
  spaceId: string
  userId: string
  personaId: string
  productIds?: string[] | null
  targetKeywords?: string[] | null
  ideas: IdeaItem[]
  userPromptInput?: string | null
}): Promise<{ ideationId: string }> {
  const productIds = input.productIds?.filter(Boolean) ?? []
  const saved = await prisma.$transaction(async (tx) => {
    const ideation = await tx.ideation.create({
      data: {
        spaceId: input.spaceId,
        userId: input.userId,
        personaId: input.personaId,
        targetKeywords: (input.targetKeywords ?? []) as never,
        generatedBy: 'USER',
        ideas: input.ideas as never,
      },
      select: { id: true },
    })
    if (productIds.length > 0) {
      await tx.ideationProduct.createMany({
        data: productIds.map((productId) => ({ ideationId: ideation.id, productId })),
        skipDuplicates: true,
      })
    }
    return ideation
  })
  return { ideationId: saved.id }
}
