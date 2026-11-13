import { z } from 'zod'
import type { ActionDefinition } from './types'
import { prisma } from '@/lib/prisma'
import { ToolUserError } from '@/lib/agent/tools/errors'
import { generatePlanNo } from '@/lib/inv/reorder-seq'
import { computeProductPlan, isModelKey, loadPlanOptionInputs } from '@/lib/inv/reorder-engine'
import { DEFAULT_PRODUCTION_LEAD_TIME_DAYS as DEFAULT_LEAD_TIME_DAYS } from '@/lib/inv/reorder-calculator'
import { readTargetKeywords, applyKeywordsToTarget } from '@/lib/sh/keyword-apply'
import { applyKeywordOps } from '@/lib/sh/keyword-review'
import { lastChangeAt, isMeasuring, MEASURE_DAYS } from '@/lib/sh/keyword-review-query'
import { keywordListSchema } from '@/lib/sh/schemas'
import { plannedStockQty } from '@/lib/inv/planned-stock'

// 제네릭 파라미터 액션을 배열(ActionDefinition[])에 담기 위한 위더너(finance.ts와 동일 패턴).
function def<T>(d: ActionDefinition<T>): ActionDefinition {
  return d as unknown as ActionDefinition
}

const DEFAULT_WINDOW_DAYS = 90
const DEFAULT_TARGET_COVER_DAYS = 30

// ─── 3) seller-hub.reorder.plan.create ───────────────────────────────────────
// 발주 계획 라우트(app/api/sh/inventory/reorder/plan/route.ts)와 같은 입력 로더(loadPlanOptionInputs)와
// 같은 상품 단위 계산(computeProductPlan)을 쓴다 — 수량 공식·모델 선택·bias 가 화면 생성과 같다.
// 모델 = 상품 발주 설정의 선택 모델, 없으면 백테스트 추천 모델.
//
// 의도적으로 생략(라우트 위저드 전용):
//   - 레이어드/로켓 세트 감지 (setSpecs, rocketChannel) — 비레이어드 상품 계획만 만든다
//   - optionFinalOverrides / excludeRocketLayer / dryRun / 모델 지정(modelByProduct)
//   - 신상품 옵션(이력 60일 미만) 수동 수량 입력 — 입력 수단이 없어 MANUAL·수량 0 으로 저장된다
//   - LLM rationale (결정론적 텍스트만 저장)
//   - bias 정산 실행(settleEligiblePlans) — 이미 정산된 계획의 bias 는 로더가 반영한다
//   - P2002 planNo 충돌 재시도 (generatePlanNo 1회)
const reorderPlanParams = z.object({
  productId: z.string(),
  optionIds: z.array(z.string()).optional(),
  memo: z.string().optional(),
})

const reorderPlanCreate: ActionDefinition<z.infer<typeof reorderPlanParams>> = {
  actionType: 'seller-hub.reorder.plan.create',
  deckKey: 'seller-hub',
  title: '발주 계획 생성',
  paramsSchema: reorderPlanParams,
  requiredRole: 'ADMIN',
  // 제안 시점 검증 — 다른 Space 의 상품 id 로 승인 불가 액션이 큐에 쌓이지 않게(실행 시점에도 spaceId 로 막는다).
  validateCreate: async (ctx, params) => {
    const product = await prisma.invProduct.findFirst({
      where: { id: params.productId, spaceId: ctx.spaceId, status: 'ACTIVE' },
      select: { id: true, reorderConfig: { select: { excludeFromForecast: true } } },
    })
    if (!product)
      throw new ToolUserError(`이 Space 에서 활성 상품을 찾을 수 없습니다: ${params.productId}`)
    if (product.reorderConfig?.excludeFromForecast)
      throw new ToolUserError('발주 예측에서 제외된 상품입니다. 발주 설정에서 제외를 해제하세요.')
  },
  execute: async (ctx, params) => {
    const spaceId = ctx.spaceId
    // createdById는 User FK — 제안자가 에이전트일 수 있으므로 승인한 구성원으로 기록한다.
    const userId = ctx.deciderId
    if (!userId) throw new Error('승인자 정보가 없습니다')

    const selectedOptionIds =
      Array.isArray(params.optionIds) && params.optionIds.length > 0 ? params.optionIds : null

    // ── 1) 상품 + 옵션 + 발주 설정 로드 (활성 상품만) ──
    const product = await prisma.invProduct.findFirst({
      where: { spaceId, status: 'ACTIVE', id: params.productId },
      select: {
        id: true,
        reorderRoundUnit: true,
        options: {
          // 삭제·단종 옵션은 생산·발주 대상이 아니다
          where: {
            deletedAt: null,
            status: 'ACTIVE',
            ...(selectedOptionIds ? { id: { in: selectedOptionIds } } : {}),
          },
          select: { id: true, safetyStockQty: true, createdAt: true },
        },
        reorderConfig: {
          select: {
            leadTimeDays: true,
            analysisWindowDays: true,
            targetCoverDays: true,
            excludeFromForecast: true,
            forecastModel: true,
          },
        },
      },
    })
    if (!product) {
      throw new Error('선택한 상품을 찾을 수 없습니다 (활성 상태가 아니거나 권한 없음)')
    }
    if (product.reorderConfig?.excludeFromForecast) {
      throw new Error('발주 예측에서 제외된 상품입니다. 발주 설정에서 제외를 해제하세요.')
    }
    if (product.options.length === 0) throw new Error('선택된 옵션이 없습니다')

    const leadTimeDays = product.reorderConfig?.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS
    const windowDays = product.reorderConfig?.analysisWindowDays ?? DEFAULT_WINDOW_DAYS
    const targetCoverDays = product.reorderConfig?.targetCoverDays ?? DEFAULT_TARGET_COVER_DAYS
    const roundUnit = product.reorderRoundUnit ?? 10
    const storedModel = product.reorderConfig?.forecastModel
    const now = new Date()

    // ── 2) 입력 로드 + 상품 단위 계산 (발주 계획 라우트와 공용) ──
    const { optionInputsByProduct, realizedByProduct } = await loadPlanOptionInputs({
      spaceId,
      products: [product],
      now,
      rocketChannelId: null,
    })
    const optionInputs = optionInputsByProduct.get(product.id) ?? []
    const results = computeProductPlan({
      options: optionInputs,
      product: {
        leadTimeDays,
        targetCoverDays,
        roundUnit,
        windowDays,
        configModel: isModelKey(storedModel) ? storedModel : null,
        realized: realizedByProduct.get(product.id),
        layered: false,
      },
      now,
    })
    const itemInputs = results.map((plan, idx) => {
      const input = optionInputs[idx]
      return {
        plan,
        biasAdjustFactor: input.biasFactor,
        safetyStockQty: input.safetyStockQty,
        onHandStock: input.stock.onHandQty,
        incomingQty: input.stock.incomingQty,
        currentStock: plannedStockQty({
          onHandQty: input.stock.onHandQty,
          incomingQty: input.stock.incomingQty,
        }),
      }
    })

    // ── 3) 트랜잭션 저장 (LLM 없이 결정론적 rationale) ──
    const planId = await prisma.$transaction(async (tx) => {
      const planNo = await generatePlanNo(spaceId, tx)
      const totalSuggestedQty = itemInputs.reduce((s, i) => s + i.plan.roundedSuggestedQty, 0)
      const biasAdjustApplied: Record<string, number> = {}
      for (const item of itemInputs) biasAdjustApplied[item.plan.optionId] = item.biasAdjustFactor

      const plan = await tx.reorderPlan.create({
        data: {
          spaceId,
          planNo,
          productId: params.productId,
          locationId: null,
          status: 'DRAFT',
          windowDays: DEFAULT_WINDOW_DAYS,
          createdById: userId,
          totalSuggestedQty,
          totalFinalQty: 0,
          memo: params.memo ?? null,
          biasAdjustApplied,
        },
        select: { id: true },
      })

      await tx.reorderPlanItem.createMany({
        data: itemInputs.map((item) => ({
          planId: plan.id,
          optionId: item.plan.optionId,
          productId: params.productId,
          currentStock: item.currentStock,
          dailyAvgForecast: item.plan.dailyRate,
          forecastModel: item.plan.selectedModel,
          modelForecasts: item.plan.modelForecasts,
          leadTimeDays,
          safetyStockQty: item.safetyStockQty,
          suggestedQty: item.plan.suggestedQty,
          roundedSuggestedQty: item.plan.roundedSuggestedQty,
          finalQty: item.plan.finalQty,
          roundUnit,
          // 결정론적 rationale — LLM 미사용(승인 큐 액션은 동기 실행, 외부 호출 최소화).
          rationale: `${item.plan.selectedModel} 모델 일평균 ${item.plan.dailyRate.toFixed(2)}개 × (리드타임 ${leadTimeDays}일 + 목표 커버 ${targetCoverDays}일) + 안전재고 ${item.safetyStockQty}개 − 현재고·생산 중 ${item.currentStock}개.`,
          biasAdjustFactor: item.biasAdjustFactor,
          confidenceScore: null,
          inputsSnapshot: JSON.parse(
            JSON.stringify({
              selectedModel: item.plan.selectedModel,
              recommendedModel: item.plan.recommendedModel,
              targetCoverDays,
              isNewOption: item.plan.isNewOption,
              biasAdjustFactor: item.biasAdjustFactor,
              windowDays,
              leadTimeDays,
              safetyStockQty: item.safetyStockQty,
              currentStock: item.currentStock,
              onHandStock: item.onHandStock,
              incomingQty: item.incomingQty,
            })
          ),
        })),
      })

      return plan.id
    })

    return { planId, itemCount: itemInputs.length }
  },
}

// ─── seller-hub.keywords.update ─────────────────────────────────────────────
// 상품(채널상품/단독 리스팅) 단위 키워드 추가·삭제 묶음. 상품명은 건드리지 않는다.
// 멱등: 같은 대상에 PENDING 제안이 있으면 새 제안을 거부한다(승인 큐 중복 방지).
const keywordUpdateParams = z
  .object({
    target: z
      .object({ channelProductId: z.string().optional(), listingId: z.string().optional() })
      .refine((t) => Boolean(t.channelProductId) !== Boolean(t.listingId), {
        message: 'target 은 channelProductId 또는 listingId 중 정확히 하나여야 합니다',
      }),
    add: z.array(z.string()).max(10),
    remove: z.array(z.string()).max(30),
    evidence: z.record(z.string(), z.object({ orders: z.number(), clicks: z.number() })).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((p) => p.add.length + p.remove.length > 0, {
    message: '추가 또는 삭제할 키워드가 필요합니다',
  })

type KeywordUpdateParams = z.infer<typeof keywordUpdateParams>

const keywordUpdate: ActionDefinition<KeywordUpdateParams> = {
  actionType: 'seller-hub.keywords.update',
  deckKey: 'seller-hub',
  title: '키워드 묶음 반영',
  paramsSchema: keywordUpdateParams,
  requiredRole: 'ADMIN',
  retryableAfterFailure: true, // 실패 시 단일 트랜잭션이라 변경이 남지 않는다
  validateCreate: async (ctx, params) => {
    const cur = await readTargetKeywords(ctx.spaceId, params.target)
    if (!cur) throw new ToolUserError('이 Space 에서 대상을 찾을 수 없습니다')
    // 그룹 소속 리스팅의 키워드는 채널상품 단위로 관리한다.
    if ('channelProductId' in cur && cur.channelProductId) {
      throw new ToolUserError(
        `그룹 소속 리스팅입니다. channelProductId(${cur.channelProductId})로 제안하세요`
      )
    }
    const r = applyKeywordOps(cur.keywords, params.add, params.remove, cur.limit)
    if (!r.ok) throw new ToolUserError(r.message)
    const valid = keywordListSchema.safeParse(r.keywords)
    if (!valid.success)
      throw new ToolUserError(valid.error.issues[0]?.message ?? '키워드 형식 오류')
    const id = params.target.channelProductId ?? params.target.listingId
    const key = params.target.channelProductId ? 'channelProductId' : 'listingId'
    const dup = await prisma.agentPendingAction.findFirst({
      where: {
        spaceId: ctx.spaceId,
        actionType: 'seller-hub.keywords.update',
        status: 'PENDING',
        expiresAt: { gt: new Date() }, // 만료됐지만 아직 EXPIRED 전환 전인 제안은 중복으로 보지 않는다
        payload: { path: ['target', key], equals: id },
      },
      select: { id: true },
    })
    if (dup) throw new ToolUserError(`이미 승인 대기 중인 키워드 제안이 있습니다: ${dup.id}`)
    const at = (
      await lastChangeAt(ctx.spaceId, [
        { kind: params.target.channelProductId ? 'channelProduct' : 'listing', id: id! },
      ])
    ).get(id!)
    if (isMeasuring(at))
      throw new ToolUserError(
        `최근 ${MEASURE_DAYS}일 안에 상품명·키워드가 바뀐 상품입니다(${at!.toISOString().slice(0, 10)}). 효과 측정이 끝난 뒤 제안하세요`
      )
  },
  snapshot: async (ctx, params) => {
    const cur = await readTargetKeywords(ctx.spaceId, params.target)
    return cur
      ? { name: cur.name, keywordCount: cur.keywords.length, keywords: cur.keywords.join(', ') }
      : null
  },
  execute: async (ctx, params) => {
    const cur = await readTargetKeywords(ctx.spaceId, params.target)
    if (!cur) throw new Error('대상을 찾을 수 없습니다')
    const r = applyKeywordOps(cur.keywords, params.add, params.remove, cur.limit)
    if (!r.ok) throw new Error(r.message)
    const valid = keywordListSchema.safeParse(r.keywords)
    if (!valid.success) throw new Error(valid.error.issues[0]?.message ?? '키워드 형식 오류')
    await applyKeywordsToTarget({
      spaceId: ctx.spaceId,
      target: params.target,
      before: cur.keywords,
      after: r.keywords,
      name: cur.name,
      productId: cur.productId,
      channelProductId: 'channelProductId' in cur ? cur.channelProductId : null,
      actorUserId: ctx.deciderId ?? null,
    })
    return { before: cur.keywords, after: r.keywords }
  },
}

// seller-hub deck 승인 큐 액션.
export const sellerHubActions: ActionDefinition[] = [def(reorderPlanCreate), def(keywordUpdate)]
