import { z } from 'zod'
import type { ActionDefinition } from './types'
import { prisma } from '@/lib/prisma'
import { ToolUserError } from '@/lib/agent/tools/errors'
import { forecastOption, buildDailySeries } from '@/lib/inv/forecast'
import { computeBiasAdjust } from '@/lib/inv/forecast/bias-adjust'
import { roundUp } from '@/lib/inv/round'
import { generatePlanNo } from '@/lib/inv/reorder-seq'
import { loadOptionDemand } from '@/lib/inv/option-demand'
import { readTargetKeywords, applyKeywordsToTarget } from '@/lib/sh/keyword-apply'
import { applyKeywordOps } from '@/lib/sh/keyword-review'
import { keywordListSchema } from '@/lib/sh/schemas'
import { plannedStockQty, sumIncomingProductionQtyByOption } from '@/lib/inv/planned-stock'

// 제네릭 파라미터 액션을 배열(ActionDefinition[])에 담기 위한 위더너(finance.ts와 동일 패턴).
function def<T>(d: ActionDefinition<T>): ActionDefinition {
  return d as unknown as ActionDefinition
}

const DEFAULT_WINDOW_DAYS = 90
const DEFAULT_LEAD_TIME_DAYS = 7

// ─── 3) seller-hub.reorder.plan.create (최소 구현) ──────────────────────────
// ⚠️ 원본 app/api/sh/inventory/reorder/plan/route.ts POST는 730줄 인라인 모놀리스로
//   레이어드(로켓 세트)·optionFinalOverrides·LLM rationale·bias 정산(settleEligiblePlans)·
//   P2002 재시도를 포함한 위저드다. route 파일 수정은 스코프 밖이고 전체 흐름을 감싼
//   재사용 가능한 lib 함수가 없으므로, 이 액션은 **상품 단위·비레이어드 실생성 핵심만**
//   재현한다(공유 예측 primitive 직접 호출 = 기계적 재사용).
//
// 의도적으로 생략(전부 반환 report에 명시):
//   - 레이어드/로켓 세트 감지 (setSpecs, rocketChannel)
//   - optionFinalOverrides / excludeRocketLayer / dryRun
//   - LLM rationale (결정론적 폴백 텍스트만 저장)
//   - bias 정산(settleEligiblePlans) 및 직전 계획 bias 로드 → computeBiasAdjust(null)=1.0
//   - P2002 planNo 충돌 재시도 (generatePlanNo 1회)
//   - reorderPlanSet 라인 (세트 모드 전용)
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
      select: { id: true },
    })
    if (!product)
      throw new ToolUserError(`이 Space 에서 활성 상품을 찾을 수 없습니다: ${params.productId}`)
  },
  execute: async (ctx, params) => {
    const spaceId = ctx.spaceId
    // createdById는 User FK — 제안자가 에이전트일 수 있으므로 승인한 구성원으로 기록한다.
    const userId = ctx.deciderId
    if (!userId) throw new Error('승인자 정보가 없습니다')

    const selectedOptionIds =
      Array.isArray(params.optionIds) && params.optionIds.length > 0 ? params.optionIds : null

    // ── 1) 상품 + 옵션 + 예측 설정 로드 (활성 상품만) ──
    const product = await prisma.invProduct.findFirst({
      where: { spaceId, status: 'ACTIVE', id: params.productId },
      select: {
        id: true,
        reorderRoundUnit: true,
        options: {
          ...(selectedOptionIds ? { where: { id: { in: selectedOptionIds } } } : {}),
          select: { id: true, safetyStockQty: true },
        },
        reorderConfig: { select: { leadTimeDays: true, analysisWindowDays: true } },
      },
    })
    if (!product) {
      throw new Error('선택한 상품을 찾을 수 없습니다 (활성 상태가 아니거나 권한 없음)')
    }
    if (product.options.length === 0) throw new Error('선택된 옵션이 없습니다')

    const optionIds = product.options.map((o) => o.id)
    const optionIdSet = new Set(optionIds)
    const leadTimeDays = product.reorderConfig?.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS
    const windowDays = product.reorderConfig?.analysisWindowDays ?? DEFAULT_WINDOW_DAYS
    const roundUnit = product.reorderRoundUnit ?? 10

    // ── 2) 현재 재고 + 입고 예정(생산 중) ──
    const stockGroups = await prisma.invStockLevel.groupBy({
      by: ['optionId'],
      where: { spaceId, optionId: { in: optionIds } },
      _sum: { quantity: true },
    })
    const stockByOption = new Map<string, number>()
    for (const g of stockGroups) stockByOption.set(g.optionId, g._sum.quantity ?? 0)

    const pendingRuns = await prisma.productionRun.findMany({
      where: { spaceId, status: 'ORDERED', items: { some: { optionId: { in: optionIds } } } },
      select: {
        status: true,
        items: {
          where: { optionId: { in: optionIds } },
          select: { optionId: true, quantity: true },
        },
      },
    })
    const incomingByOption = sumIncomingProductionQtyByOption(pendingRuns)

    // ── 3) 주문수요 로드(활성 채널 전수) → 옵션별 일별 집계 ──
    const now = new Date()
    const since = new Date(
      now.getTime() - Math.max(DEFAULT_WINDOW_DAYS, windowDays) * 24 * 60 * 60 * 1000
    )
    const activeChannels = await prisma.channel.findMany({
      where: { spaceId, isActive: true },
      select: { id: true, name: true, externalSource: true },
    })
    const demandRows = await loadOptionDemand(spaceId, since, now, activeChannels)
    const dailyByOption = new Map<string, Record<string, number>>()
    for (const id of optionIds) dailyByOption.set(id, {})
    for (const row of demandRows) {
      if (!optionIdSet.has(row.optionId)) continue
      const byDate = dailyByOption.get(row.optionId)!
      byDate[row.date] = (byDate[row.date] ?? 0) + row.quantity
    }

    // ── 4) 옵션별 예측 + 수량 계산 (bias=1.0 폴백) ──
    const itemInputs = product.options.map((o) => {
      const history = buildDailySeries(dailyByOption.get(o.id) ?? {}, windowDays, now)
      const forecastResult = forecastOption({ history, leadTimeDays })
      const biasAdjustFactor = computeBiasAdjust(null) // 직전 계획 bias 미로드 → 1.0

      const onHandStock = stockByOption.get(o.id) ?? 0
      const incomingQty = incomingByOption.get(o.id) ?? 0
      const currentStock = plannedStockQty({ onHandQty: onHandStock, incomingQty })
      const safetyStockQty = o.safetyStockQty

      const rawQty =
        forecastResult.dailyAvg * biasAdjustFactor * leadTimeDays + safetyStockQty - currentStock
      const suggestedQty = Math.max(0, Math.ceil(rawQty))
      const roundedSuggestedQty = suggestedQty > 0 ? roundUp(suggestedQty, roundUnit) : 0

      return {
        optionId: o.id,
        forecastResult,
        biasAdjustFactor,
        currentStock,
        onHandStock,
        incomingQty,
        safetyStockQty,
        suggestedQty,
        roundedSuggestedQty,
      }
    })

    // ── 5) 트랜잭션 저장 (LLM 없이 결정론적 rationale) ──
    const planId = await prisma.$transaction(async (tx) => {
      const planNo = await generatePlanNo(spaceId, tx)
      const totalSuggestedQty = itemInputs.reduce((s, i) => s + i.roundedSuggestedQty, 0)
      const biasAdjustApplied: Record<string, number> = {}
      for (const item of itemInputs) biasAdjustApplied[item.optionId] = item.biasAdjustFactor

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
          optionId: item.optionId,
          productId: params.productId,
          currentStock: item.currentStock,
          dailyAvgForecast: item.forecastResult.dailyAvg,
          forecastModel: item.forecastResult.model,
          leadTimeDays,
          safetyStockQty: item.safetyStockQty,
          suggestedQty: item.suggestedQty,
          roundedSuggestedQty: item.roundedSuggestedQty,
          finalQty: item.roundedSuggestedQty,
          roundUnit,
          // 결정론적 rationale — LLM 미사용(승인 큐 액션은 동기 실행, 외부 호출 최소화).
          rationale: `${item.forecastResult.model} 예측 일평균 ${item.forecastResult.dailyAvg.toFixed(2)}개, 리드타임 ${leadTimeDays}일 + 안전재고 ${item.safetyStockQty}개 (현재재고 ${item.currentStock}개).`,
          biasAdjustFactor: item.biasAdjustFactor,
          confidenceScore: item.forecastResult.confidence,
          inputsSnapshot: JSON.parse(
            JSON.stringify({
              profile: item.forecastResult.debug.profile ?? null,
              forecastDebug: item.forecastResult.debug,
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
    const r = applyKeywordOps(cur.keywords, params.add, params.remove)
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
    const r = applyKeywordOps(cur.keywords, params.add, params.remove)
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
