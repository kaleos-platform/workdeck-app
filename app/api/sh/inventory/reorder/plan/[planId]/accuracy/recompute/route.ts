// POST /api/sh/inventory/reorder/plan/[planId]/accuracy/recompute
// 연결된 ProductionRun.stockedInAt 기준으로 적중률 일괄 계산
// → ReorderPlanAccuracy upsert, plan.status = CONSUMED
//
// 전제: 계획이 FINALIZED 상태이고 연결된 ProductionRun에 stockedInAt이 있어야 함.

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { computeAccuracy } from '@/lib/inv/forecast/accuracy'
import { mapWithConcurrency } from '@/lib/concurrency'

// DB 동시 작업 상한 (connection pool 보호)
const ACCURACY_CONCURRENCY = 5

export async function POST(_req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { planId } = await params

  // 계획 로드
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

  if (!plan || plan.spaceId !== spaceId) {
    return errorResponse('발주 계획을 찾을 수 없습니다', 404)
  }
  if (plan.status !== 'FINALIZED') {
    return errorResponse('FINALIZED 상태의 계획만 적중률 계산이 가능합니다', 409)
  }

  // optionId → stockedInAt 매핑 (연결 ProductionRun 기준)
  const optionStockedInMap = new Map<string, Date>()
  const optionFinalQtyMap = new Map<string, number>()

  for (const run of plan.productionRuns) {
    if (!run.stockedInAt) continue
    for (const runItem of run.items) {
      // 여러 run이 같은 option을 포함하는 경우 최신 stockedInAt 사용
      const existing = optionStockedInMap.get(runItem.optionId)
      if (!existing || run.stockedInAt > existing) {
        optionStockedInMap.set(runItem.optionId, run.stockedInAt)
        optionFinalQtyMap.set(runItem.optionId, runItem.quantity)
      }
    }
  }

  if (optionStockedInMap.size === 0) {
    return errorResponse('입고 완료(stockedInAt)된 ProductionRun이 없습니다', 400)
  }

  const evaluatedAt = new Date()

  // 옵션별 적중률 계산 + upsert를 동시 처리 (각 옵션 독립, distinct row → 충돌 없음)
  // $transaction으로 감싸지 않음: interactive tx는 동시 쿼리 미지원
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

    await prisma.reorderPlanAccuracy.upsert({
      where: {
        // @@unique([planId, optionId]) 기반 표준 upsert
        planId_optionId: { planId, optionId: item.optionId },
      },
      create: {
        planId,
        optionId: item.optionId,
        evaluatedAt,
        periodStart: stockedInAt,
        periodEnd,
        actualOutbound: accuracy.actualOutbound,
        forecastOutbound: accuracy.forecastOutbound,
        wape: accuracy.wape,
        bias: accuracy.bias,
        stockoutDays: accuracy.stockoutDays,
        overstockDays: accuracy.overstockDays,
      },
      update: {
        evaluatedAt,
        periodStart: stockedInAt,
        periodEnd,
        actualOutbound: accuracy.actualOutbound,
        forecastOutbound: accuracy.forecastOutbound,
        wape: accuracy.wape,
        bias: accuracy.bias,
        stockoutDays: accuracy.stockoutDays,
        overstockDays: accuracy.overstockDays,
      },
    })

    return {
      optionId: item.optionId,
      wape: accuracy.wape,
      bias: accuracy.bias,
      stockoutDays: accuracy.stockoutDays,
      overstockDays: accuracy.overstockDays,
    }
  })

  const results = computed.filter((r): r is NonNullable<typeof r> => r !== null)

  // 계획 상태 CONSUMED로 전환
  await prisma.reorderPlan.update({
    where: { id: planId },
    data: { status: 'CONSUMED' },
  })

  return NextResponse.json({
    planId,
    status: 'CONSUMED',
    evaluatedAt,
    accuracies: results,
  })
}
