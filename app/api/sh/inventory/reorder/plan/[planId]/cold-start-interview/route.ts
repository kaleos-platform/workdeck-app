// POST /api/sh/inventory/reorder/plan/[planId]/cold-start-interview
// COLD_START 프로파일 옵션 묶음을 LLM에 보내 질문 생성.
// 응답을 prior로 변환해 planItem.inputsSnapshot 업데이트 + suggestedQty 재계산.
//
// 요청 바디 (선택):
//   { answers?: { optionId: string, targetDailySales: number, seasonFactor?: number }[] }
//   answers 없으면 LLM 질문 생성 모드
//   answers 있으면 prior 업데이트 + suggestedQty 재계산 모드

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { generateTextWithFallback } from '@/lib/ai/providers'
import { forecastBayesian } from '@/lib/inv/forecast/bayesian'
import { roundUp } from '@/lib/inv/round'

const AnswerSchema = z.object({
  answers: z
    .array(
      z.object({
        optionId: z.string(),
        targetDailySales: z.number().min(0),
        seasonFactor: z.number().min(0.1).max(5).optional(),
      })
    )
    .optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { planId } = await params

  // 계획 로드
  const plan = await prisma.reorderPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      spaceId: true,
      status: true,
      locationId: true,
      productId: true,
      _count: { select: { sets: true } },
      items: {
        select: {
          id: true,
          optionId: true,
          forecastModel: true,
          leadTimeDays: true,
          safetyStockQty: true,
          currentStock: true,
          roundUnit: true,
          biasAdjustFactor: true,
          inputsSnapshot: true,
          option: { select: { name: true } },
          product: { select: { name: true, internalName: true } },
        },
      },
    },
  })

  if (!plan || plan.spaceId !== spaceId) {
    return errorResponse('발주 계획을 찾을 수 없습니다', 404)
  }
  if (plan.status !== 'DRAFT') {
    return errorResponse('DRAFT 상태의 계획만 수정할 수 있습니다', 409)
  }
  // 레이어드 발주는 콜드스타트 단일레이어 공식이 합산 finalQty를 덮어써 세트 기여를 잃으므로 차단.
  const isLayered = plan.locationId == null && plan.productId != null && plan._count.sets > 0
  if (isLayered) {
    return errorResponse(
      '레이어드 발주(연동 세트 + 직접 배송) 계획은 콜드스타트 인터뷰를 지원하지 않습니다. 세트 수량/옵션 수량을 직접 조정하세요.',
      409
    )
  }

  // COLD_START 아이템만 추출
  const coldItems = plan.items.filter((i) => i.forecastModel === 'BAYES')
  if (coldItems.length === 0) {
    return errorResponse('COLD_START 프로파일 아이템이 없습니다', 404)
  }

  // 요청 바디 파싱
  let body: z.infer<typeof AnswerSchema> = {}
  try {
    body = AnswerSchema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    return errorResponse('요청 데이터가 유효하지 않습니다', 400, { detail: String(e) })
  }

  // ── 질문 생성 모드 ──────────────────────────────────────────────────────────
  if (!body.answers || body.answers.length === 0) {
    const itemList = coldItems
      .map(
        (i, idx) =>
          `${idx + 1}. ${i.product.internalName || i.product.name} / ${i.option.name} (optionId: ${i.optionId})`
      )
      .join('\n')

    let questions: string
    try {
      const { result } = await generateTextWithFallback({
        system:
          '당신은 재고 관리 전문가입니다. 신규 상품의 초기 발주 수량을 결정하기 위해 필요한 정보를 질문하세요.',
        messages: [
          {
            role: 'user',
            content: `다음 신규 상품들의 초기 발주를 계획하고 있습니다. 목표 일판매량, 시즌/행사 계획 등을 파악하기 위한 질문을 한국어로 간결하게 생성해주세요.\n\n${itemList}`,
          },
        ],
        maxTokens: 300,
        temperature: 0.4,
      })
      questions = result.content.trim()
    } catch {
      questions = coldItems
        .map(
          (i) =>
            `${i.product.internalName || i.product.name} / ${i.option.name}: 목표 일판매량은 얼마인가요? 시즌 또는 행사 계획이 있나요?`
        )
        .join('\n')
    }

    return NextResponse.json({
      mode: 'questions',
      coldStartItems: coldItems.map((i) => ({
        optionId: i.optionId,
        productName: i.product.internalName || i.product.name,
        optionName: i.option.name,
      })),
      questions,
    })
  }

  // ── prior 업데이트 + 재계산 모드 ─────────────────────────────────────────
  const answerMap = new Map(body.answers.map((a) => [a.optionId, a]))

  const updates = await prisma.$transaction(async (tx) => {
    const results: Array<{ optionId: string; newSuggestedQty: number; newFinalQty: number }> = []

    for (const item of coldItems) {
      const answer = answerMap.get(item.optionId)
      if (!answer) continue

      // targetDailySales를 prior의 alpha/beta로 변환
      // prior: alpha0 = targetDailySales (강한 prior), beta0 = 1
      const seasonFactor = answer.seasonFactor ?? 1.0
      const priorAlpha = answer.targetDailySales * seasonFactor
      const priorBeta = 1

      // inputsSnapshot에서 이력 재구성 불가 → prior만 사용해 Bayesian 예측
      // (이력이 없는 콜드스타트이므로 빈 배열 전달)
      const forecastResult = forecastBayesian([], { alpha0: priorAlpha, beta0: priorBeta })

      const biasAdjustFactor = Number(item.biasAdjustFactor)
      const rawQty =
        forecastResult.dailyAvg * biasAdjustFactor * item.leadTimeDays +
        item.safetyStockQty -
        item.currentStock
      const suggestedQty = Math.max(0, Math.ceil(rawQty))
      const roundedSuggestedQty = suggestedQty > 0 ? roundUp(suggestedQty, item.roundUnit) : 0

      // inputsSnapshot 업데이트
      const existingSnapshot =
        typeof item.inputsSnapshot === 'object' && item.inputsSnapshot !== null
          ? (item.inputsSnapshot as Record<string, unknown>)
          : {}

      await tx.reorderPlanItem.update({
        where: { id: item.id },
        data: {
          dailyAvgForecast: forecastResult.dailyAvg,
          suggestedQty,
          roundedSuggestedQty,
          finalQty: roundedSuggestedQty,
          confidenceScore: forecastResult.confidence,
          inputsSnapshot: JSON.parse(
            JSON.stringify({
              ...existingSnapshot,
              coldStartInterview: {
                targetDailySales: answer.targetDailySales,
                seasonFactor,
                prior: { alpha0: priorAlpha, beta0: priorBeta },
                updatedAt: new Date().toISOString(),
              },
              forecastDebug: forecastResult.debug,
            })
          ),
        },
      })

      results.push({
        optionId: item.optionId,
        newSuggestedQty: roundedSuggestedQty,
        newFinalQty: roundedSuggestedQty,
      })
    }

    // totalFinalQty 재계산
    const allItems = await tx.reorderPlanItem.findMany({
      where: { planId },
      select: { finalQty: true },
    })
    const totalFinalQty = allItems.reduce((s, i) => s + i.finalQty, 0)
    await tx.reorderPlan.update({
      where: { id: planId },
      data: { totalFinalQty },
    })

    return results
  })

  return NextResponse.json({ mode: 'updated', updates })
}
