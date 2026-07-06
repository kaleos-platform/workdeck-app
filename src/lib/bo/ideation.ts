import { prisma } from '@/lib/prisma'
import { generateTextWithFallback } from '@/lib/ai/providers'
import { buildBoIdeationPrompt, type BoProductCtx } from './prompts'
import { boIdeationResponseSchema } from './ideation-schemas'

// ─── 입출력 타입 ──────────────────────────────────────────────────────────────

export interface RunBoIdeationInput {
  spaceId: string
  userId?: string | null
  productId: string
  userPromptInput?: string | null
}

export interface RunBoIdeationSuccess {
  ok: true
  ideationId: string
  appealPointsCount: number
  materialsCount: number
  providerName: string
}

export interface RunBoIdeationFailure {
  ok: false
  code: 'AI_FAILURE' | 'PARSE_FAILURE' | 'NOT_CONFIGURED' | 'PRODUCT_NOT_FOUND'
  message: string
  detail?: string
}

export type RunBoIdeationResult = RunBoIdeationSuccess | RunBoIdeationFailure

// ─── 내부 유틸 ────────────────────────────────────────────────────────────────

function stripCodeFence(s: string): string {
  const m = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(s.trim())
  return m ? m[1].trim() : s
}

function parseJsonSafe(raw: string): { parsed: unknown; error?: string } {
  try {
    return { parsed: JSON.parse(stripCodeFence(raw.trim())) }
  } catch (err) {
    return { parsed: null, error: err instanceof Error ? err.message : 'JSON parse error' }
  }
}

// ─── 오케스트레이터 ───────────────────────────────────────────────────────────

export async function runBoIdeation(input: RunBoIdeationInput): Promise<RunBoIdeationResult> {
  // 공간 범위 내 제품 조회 (IDOR 방어)
  const product = await prisma.boProduct.findFirst({
    where: { id: input.productId, spaceId: input.spaceId },
    select: {
      id: true,
      name: true,
      category: true,
      oneLinerPitch: true,
      homepageUrl: true,
      crawledText: true,
      targetCustomer: true,
      features: true,
      customFields: true,
    },
  })

  if (!product) {
    return {
      ok: false,
      code: 'PRODUCT_NOT_FOUND',
      message: '해당 제품을 찾을 수 없습니다',
    }
  }

  const productCtx: BoProductCtx = {
    id: product.id,
    name: product.name,
    category: product.category,
    oneLinerPitch: product.oneLinerPitch,
    homepageUrl: product.homepageUrl,
    crawledText: product.crawledText,
    targetCustomer: product.targetCustomer,
    features: Array.isArray(product.features)
      ? (product.features as Array<{ name: string; description: string }>)
      : null,
    customFields: Array.isArray(product.customFields)
      ? (product.customFields as Array<{ key: string; value: string }>)
      : null,
  }

  const built = buildBoIdeationPrompt(productCtx, input.userPromptInput)

  // 최대 2회 시도 — 일시적 AI 실패 대응
  let attempt = 0
  let lastError: unknown

  while (attempt < 2) {
    attempt++
    try {
      const { result, providerName } = await generateTextWithFallback({
        system: built.system,
        messages: built.messages,
        responseFormat: 'json',
        maxTokens: 4096,
        temperature: 0.7,
      })

      const { parsed, error } = parseJsonSafe(result.content)
      if (error) {
        lastError = new Error(`JSON parse: ${error}`)
        continue
      }

      const validated = boIdeationResponseSchema.safeParse(parsed)
      if (!validated.success) {
        lastError = new Error(`schema: ${validated.error.message}`)
        continue
      }

      const { appealPoints, materials } = validated.data

      // BoIdeation + BoMaterial 행 일괄 생성 (트랜잭션)
      const saved = await prisma.$transaction(async (tx) => {
        const ideation = await tx.boIdeation.create({
          data: {
            spaceId: input.spaceId,
            userId: input.userId ?? null,
            productId: input.productId,
            userPromptInput: input.userPromptInput ?? null,
            appealPoints: appealPoints as never,
            providerName,
            providerModel: result.model ?? null,
            latencyMs: result.latencyMs,
            promptTraceHash: built.traceHash,
          },
          select: { id: true },
        })

        if (materials.length > 0) {
          await tx.boMaterial.createMany({
            data: materials.map((m) => ({
              spaceId: input.spaceId,
              productId: input.productId,
              ideationId: ideation.id,
              title: m.title,
              appealPoint: m.appealPoint,
              angle: m.angle,
              outline: m.outline as never,
              targetKeyword: m.targetKeyword ?? null,
              status: 'PROPOSED' as const,
            })),
          })
        }

        return ideation
      })

      return {
        ok: true,
        ideationId: saved.id,
        appealPointsCount: appealPoints.length,
        materialsCount: materials.length,
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
        ? '사용 가능한 AI 공급자가 없어 소구점을 생성하지 못했습니다'
        : code === 'PARSE_FAILURE'
          ? 'AI 응답을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요'
          : '소구점 발굴에 실패했습니다',
    detail: detail.slice(0, 500),
  }
}
