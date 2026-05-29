// 발주 계획 적중률 정산 코어 로직
//
// FINALIZED 계획 + 연결 ProductionRun.stockedInAt 기준으로 옵션별 적중률을 계산해
// ReorderPlanAccuracy upsert + plan.status = CONSUMED 전환.
//
// recompute API 라우트와 plan 생성 시점의 lazy 정산이 공유한다.
// 결과는 throw 대신 SettleResult로 반환 → 호출부에서 부분 실패를 건너뛰기 쉽게.

import { prisma } from '@/lib/prisma'
import { computeAccuracy } from '@/lib/inv/forecast/accuracy'
import { mapWithConcurrency } from '@/lib/concurrency'

// DB 동시 작업 상한 (connection pool 보호)
const ACCURACY_CONCURRENCY = 5

export type SettleAccuracyItem = {
  optionId: string
  wape: number
  bias: number
  stockoutDays: number
  overstockDays: number
}

export type SettleResult =
  | { ok: true; planId: string; evaluatedAt: Date; accuracies: SettleAccuracyItem[] }
  | { ok: false; planId: string; reason: 'NOT_FOUND' | 'NOT_FINALIZED' | 'NO_STOCKED_IN' }

// 단일 FINALIZED 계획을 정산. $transaction 미사용(동시 쿼리 trap),
// 각 옵션은 distinct (planId, optionId) row라 병렬 upsert 안전.
export async function settlePlanAccuracy(planId: string, spaceId: string): Promise<SettleResult> {
  const plan = await prisma.reorderPlan.findUnique({
    where: { id: planId },
    include: {
      items: {
        select: {
          id: true,
          optionId: true,
          leadTimeDays: true,
          finalQty: true,
          dailyAvgForecast: true,
          safetyStockQty: true,
        },
      },
      productionRuns: {
        select: {
          id: true,
          stockedInAt: true,
          items: { select: { optionId: true, quantity: true } },
        },
      },
    },
  })

  if (!plan || plan.spaceId !== spaceId) return { ok: false, planId, reason: 'NOT_FOUND' }
  if (plan.status !== 'FINALIZED') return { ok: false, planId, reason: 'NOT_FINALIZED' }

  // optionId → stockedInAt / finalQty 매핑 (연결 ProductionRun 기준, 최신 stockedInAt 우선)
  const optionStockedInMap = new Map<string, Date>()
  const optionFinalQtyMap = new Map<string, number>()
  for (const run of plan.productionRuns) {
    if (!run.stockedInAt) continue
    for (const runItem of run.items) {
      const existing = optionStockedInMap.get(runItem.optionId)
      if (!existing || run.stockedInAt > existing) {
        optionStockedInMap.set(runItem.optionId, run.stockedInAt)
        optionFinalQtyMap.set(runItem.optionId, runItem.quantity)
      }
    }
  }

  if (optionStockedInMap.size === 0) return { ok: false, planId, reason: 'NO_STOCKED_IN' }

  const evaluatedAt = new Date()

  const computed = await mapWithConcurrency(plan.items, ACCURACY_CONCURRENCY, async (item) => {
    const stockedInAt = optionStockedInMap.get(item.optionId)
    if (!stockedInAt) return null

    const finalQty = optionFinalQtyMap.get(item.optionId) ?? item.finalQty
    const dailyAvgForecast = Number(item.dailyAvgForecast)

    const accuracy = await computeAccuracy({
      planId,
      optionId: item.optionId,
      planItemId: item.id,
      stockedInAt,
      leadTimeDays: item.leadTimeDays,
      finalQty,
      dailyAvgForecast,
      safetyStockQty: item.safetyStockQty,
    })

    const periodEnd = new Date(stockedInAt)
    periodEnd.setDate(periodEnd.getDate() + item.leadTimeDays)

    const accuracyData = {
      evaluatedAt,
      periodStart: stockedInAt,
      periodEnd,
      actualOutbound: accuracy.actualOutbound,
      forecastOutbound: accuracy.forecastOutbound,
      wape: accuracy.wape,
      bias: accuracy.bias,
      stockoutDays: accuracy.stockoutDays,
      overstockDays: accuracy.overstockDays,
    }

    await prisma.reorderPlanAccuracy.upsert({
      where: { planId_optionId: { planId, optionId: item.optionId } },
      create: { planId, optionId: item.optionId, ...accuracyData },
      update: accuracyData,
    })

    return {
      optionId: item.optionId,
      wape: accuracy.wape,
      bias: accuracy.bias,
      stockoutDays: accuracy.stockoutDays,
      overstockDays: accuracy.overstockDays,
    }
  })

  const accuracies = computed.filter((r): r is SettleAccuracyItem => r !== null)

  await prisma.reorderPlan.update({
    where: { id: planId },
    data: { status: 'CONSUMED' },
  })

  return { ok: true, planId, evaluatedAt, accuracies }
}

// space 내 정산 가능한(stockedIn 있는) FINALIZED 계획을 모두 정산.
// 계획별 실패는 건너뛰고 나머지를 계속 처리 → bias 학습 루프가 멈추지 않도록.
export async function settleEligiblePlans(spaceId: string): Promise<SettleResult[]> {
  const eligible = await prisma.reorderPlan.findMany({
    where: {
      spaceId,
      status: 'FINALIZED',
      productionRuns: { some: { stockedInAt: { not: null } } },
    },
    select: { id: true },
    orderBy: { finalizedAt: 'asc' },
  })

  const results: SettleResult[] = []
  for (const { id } of eligible) {
    try {
      results.push(await settlePlanAccuracy(id, spaceId))
    } catch {
      // 단일 계획 정산 실패가 전체(및 발주 계획 생성)를 막지 않도록 무시
      results.push({ ok: false, planId: id, reason: 'NOT_FOUND' })
    }
  }
  return results
}
