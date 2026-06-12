// 발주 계획 적중률 정산 코어 로직 (순수 예측 검증 재앵커)
//
// 앵커 = 예측 검증 시작 시점(confirmedAt). 평가창 = [confirmedAt, confirmedAt + leadTimeDays].
// 생산차수(stockedInAt)와 분리 — 재고 가용성이 아닌 예측 품질을 측정.
//
// 예측값은 확정 시점 동결 스냅샷(confirmed* 필드)을 읽는다(dual-read):
//   snapshotSource=LIVE/BACKFILLED 있으면 confirmed* 사용, 없으면 live item 폴백.
// 계획이 항상 편집 가능하므로 live 값을 읽으면 사후 수정에 신뢰도가 오염됨.
//
// settle는 plan.status를 변경하지 않는다(CONSUMED 폐기). 옵션별 accuracy row만 upsert.
// recompute API 라우트와 plan 생성 시점 lazy 정산, cron 정산이 공유.

import { prisma } from '@/lib/prisma'
import { computeAccuracy } from '@/lib/inv/forecast/accuracy'
import { mapWithConcurrency } from '@/lib/concurrency'

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
  | { ok: false; planId: string; reason: 'NOT_FOUND' | 'NOT_CONFIRMED' | 'WINDOW_NOT_ELAPSED' }

// 단일 FINALIZED(확정) 계획 정산. 앵커 = confirmedAt.
export async function settlePlanAccuracy(planId: string, spaceId: string): Promise<SettleResult> {
  const plan = await prisma.reorderPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      spaceId: true,
      status: true,
      confirmedAt: true,
      supersededAt: true,
      items: {
        select: {
          id: true,
          optionId: true,
          // dual-read 소스: 동결 스냅샷 우선, 없으면 live
          leadTimeDays: true,
          finalQty: true,
          dailyAvgForecast: true,
          safetyStockQty: true,
          confirmedLeadTimeDays: true,
          confirmedFinalQty: true,
          confirmedDailyAvgForecast: true,
          confirmedSafetyStockQty: true,
          snapshotSource: true,
        },
      },
    },
  })

  if (!plan || plan.spaceId !== spaceId) return { ok: false, planId, reason: 'NOT_FOUND' }
  // 확정(FINALIZED) + 미대체 + confirmedAt 존재해야 측정 대상
  if (plan.status !== 'FINALIZED' || plan.supersededAt || !plan.confirmedAt) {
    return { ok: false, planId, reason: 'NOT_CONFIRMED' }
  }

  const anchorDate = plan.confirmedAt
  const now = Date.now()
  const evaluatedAt = new Date()

  // 옵션별 평가창 경과 여부는 옵션 leadTime마다 다름 — 경과한 옵션만 정산
  const computed = await mapWithConcurrency(plan.items, ACCURACY_CONCURRENCY, async (item) => {
    // dual-read: 동결 스냅샷 우선
    const leadTimeDays = item.confirmedLeadTimeDays ?? item.leadTimeDays
    const finalQty = item.confirmedFinalQty ?? item.finalQty
    const dailyAvgForecast = Number(item.confirmedDailyAvgForecast ?? item.dailyAvgForecast)
    const safetyStockQty = item.confirmedSafetyStockQty ?? item.safetyStockQty

    // 평가창 경과 확인: anchor + leadTime <= now
    const windowEnd = new Date(anchorDate)
    windowEnd.setDate(windowEnd.getDate() + leadTimeDays)
    if (windowEnd.getTime() > now) return null // 아직 미경과 — 건너뜀

    const accuracy = await computeAccuracy({
      spaceId,
      planId,
      optionId: item.optionId,
      planItemId: item.id,
      anchorDate,
      leadTimeDays,
      finalQty,
      dailyAvgForecast,
      safetyStockQty,
    })

    const periodEnd = new Date(anchorDate)
    periodEnd.setDate(periodEnd.getDate() + leadTimeDays)

    const accuracyData = {
      evaluatedAt,
      periodStart: anchorDate,
      periodEnd,
      actualOutbound: accuracy.actualOutbound,
      forecastOutbound: accuracy.forecastOutbound,
      wape: accuracy.wape,
      bias: accuracy.bias,
      stockoutDays: accuracy.stockoutDays,
      overstockDays: accuracy.overstockDays,
      validity: 'ACTIVE' as const,
      evaluationStatus: 'MEASURED' as const,
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

  if (accuracies.length === 0) {
    return { ok: false, planId, reason: 'WINDOW_NOT_ELAPSED' }
  }

  // plan.status 변경하지 않음 (CONSUMED 폐기 — 신뢰도는 측정값이지 종료 상태 아님)
  return { ok: true, planId, evaluatedAt, accuracies }
}

// space 내 정산 가능한 계획을 모두 정산.
// 조건: FINALIZED + 미대체 + confirmedAt 존재. (평가창 경과·미정산 판정은 옵션 단위로 내부 처리)
// 계획별 실패는 건너뛰고 나머지를 계속 처리 → bias 학습 루프가 멈추지 않도록.
export async function settleEligiblePlans(spaceId: string): Promise<SettleResult[]> {
  const eligible = await prisma.reorderPlan.findMany({
    where: {
      spaceId,
      status: 'FINALIZED',
      supersededAt: null,
      confirmedAt: { not: null },
    },
    select: { id: true },
    orderBy: { confirmedAt: 'asc' },
  })

  const results: SettleResult[] = []
  for (const { id } of eligible) {
    try {
      results.push(await settlePlanAccuracy(id, spaceId))
    } catch {
      results.push({ ok: false, planId: id, reason: 'NOT_FOUND' })
    }
  }
  return results
}
