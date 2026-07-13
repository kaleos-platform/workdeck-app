import { z } from 'zod'
import type { ActionDefinition } from './types'
import { prisma } from '@/lib/prisma'
import { forecastOption, buildDailySeries } from '@/lib/inv/forecast'
import { computeBiasAdjust } from '@/lib/inv/forecast/bias-adjust'
import { roundUp } from '@/lib/inv/round'
import { generatePlanNo } from '@/lib/inv/reorder-seq'
import { loadOptionDemand } from '@/lib/inv/option-demand'
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
  execute: async (ctx, params) => {
    const spaceId = ctx.spaceId
    const userId = ctx.requestedBy

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
        items: { where: { optionId: { in: optionIds } }, select: { optionId: true, quantity: true } },
      },
    })
    const incomingByOption = sumIncomingProductionQtyByOption(pendingRuns)

    // ── 3) 주문수요 로드(활성 채널 전수) → 옵션별 일별 집계 ──
    const now = new Date()
    const since = new Date(now.getTime() - Math.max(DEFAULT_WINDOW_DAYS, windowDays) * 24 * 60 * 60 * 1000)
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

// seller-hub deck 승인 큐 액션.
export const sellerHubActions: ActionDefinition[] = [def(reorderPlanCreate)]
