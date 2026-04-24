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
  productId?: string | null
  personaId?: string | null
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

// Unit 13 에서 ImprovementRule 테이블이 추가되면 이 함수를 교체한다.
// 현재는 scope 필터링의 자리만 마련하고 빈 배열을 반환.
async function loadActiveRules(params: {
  spaceId: string
  productId?: string | null
  personaId?: string | null
}): Promise<IdeationRule[]> {
  void params
  return []
}

async function loadBuilderContext(input: RunIdeationInput): Promise<{
  product: IdeationProductCtx | null
  persona: IdeationPersonaCtx | null
  brand: IdeationBrandCtx | null
  rules: IdeationRule[]
}> {
  const [product, persona, brand, rules] = await Promise.all([
    input.productId
      ? prisma.b2BProduct.findFirst({
          where: { id: input.productId, spaceId: input.spaceId },
          select: {
            id: true,
            name: true,
            oneLinerPitch: true,
            valueProposition: true,
            targetCustomers: true,
            keyFeatures: true,
            differentiators: true,
            painPointsAddressed: true,
          },
        })
      : null,
    input.personaId
      ? prisma.persona.findFirst({
          where: { id: input.personaId, spaceId: input.spaceId },
          select: {
            id: true,
            name: true,
            jobTitle: true,
            industry: true,
            companySize: true,
            seniority: true,
            decisionRole: true,
            goals: true,
            painPoints: true,
            objections: true,
            preferredChannels: true,
            toneHints: true,
          },
        })
      : null,
    prisma.brandProfile.findUnique({
      where: { spaceId: input.spaceId },
      select: {
        companyName: true,
        shortDescription: true,
        missionStatement: true,
        toneOfVoice: true,
        forbiddenPhrases: true,
        preferredPhrases: true,
      },
    }),
    loadActiveRules({
      spaceId: input.spaceId,
      productId: input.productId,
      personaId: input.personaId,
    }),
  ])

  return {
    product: product as IdeationProductCtx | null,
    persona: persona as IdeationPersonaCtx | null,
    brand: brand as IdeationBrandCtx | null,
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

  const builderInput: IdeationBuilderInput = {
    product: ctx.product,
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

      const saved = await prisma.contentIdea.create({
        data: {
          spaceId: input.spaceId,
          userId: input.userId,
          productId: input.productId ?? null,
          personaId: input.personaId ?? null,
          userPromptInput: input.userPromptInput ?? null,
          generatedBy: 'AI',
          ideas: validated.data.ideas,
          promptTraceHash: built.traceHash,
          ruleIdsSnapshot: built.ruleIds,
          providerName,
          providerModel: result.model ?? null,
          latencyMs: result.latencyMs,
        },
        select: { id: true },
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
  // "구성되지 않았다" 류만 NOT_CONFIGURED 로. 살아있는 공급자의 5xx 는 AI_FAILURE 로 분류.
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
  productId?: string | null
  personaId?: string | null
  ideas: IdeaItem[]
  userPromptInput?: string | null
}): Promise<{ ideationId: string }> {
  const saved = await prisma.contentIdea.create({
    data: {
      spaceId: input.spaceId,
      userId: input.userId,
      productId: input.productId ?? null,
      personaId: input.personaId ?? null,
      userPromptInput: input.userPromptInput ?? null,
      generatedBy: 'USER',
      ideas: input.ideas,
    },
    select: { id: true },
  })
  return { ideationId: saved.id }
}
