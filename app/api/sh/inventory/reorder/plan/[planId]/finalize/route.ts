// POST /api/sh/inventory/reorder/plan/[planId]/finalize
// "예측 검증 시작"(UI "확정") — DRAFT → FINALIZED 전환 + 예측 스냅샷 동결.
//
// 동작:
//  1) DRAFT 확인
//  2) 옵션별 LIVE 예측값을 confirmed* 필드로 동결(snapshotSource=LIVE) — 신뢰도 측정의 단일 진실원
//  3) plan.status=FINALIZED, confirmedAt=now
//  생산차수는 생성하지 않는다(별도 generate-run 액션). 재고와 신뢰도 측정은 분리.
//  모두 단일 트랜잭션.

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { planId } = await params

  const plan = await prisma.reorderPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      spaceId: true,
      status: true,
      items: {
        select: {
          id: true,
          dailyAvgForecast: true,
          leadTimeDays: true,
          safetyStockQty: true,
          finalQty: true,
        },
      },
    },
  })

  if (!plan || plan.spaceId !== spaceId) {
    return errorResponse('발주 계획을 찾을 수 없습니다', 404)
  }
  if (plan.status !== 'DRAFT') {
    return errorResponse('DRAFT 상태의 계획만 예측 검증을 시작할 수 있습니다', 409)
  }
  if (plan.items.length === 0) {
    return errorResponse('발주 항목이 없습니다', 400)
  }

  const confirmedAt = new Date()

  await prisma.$transaction(async (tx) => {
    // 옵션별 LIVE 예측값 동결 — accuracy.ts가 읽는 값과 정확히 일치해야 함(변환 금지)
    for (const item of plan.items) {
      await tx.reorderPlanItem.update({
        where: { id: item.id },
        data: {
          confirmedDailyAvgForecast: item.dailyAvgForecast,
          confirmedLeadTimeDays: item.leadTimeDays,
          confirmedSafetyStockQty: item.safetyStockQty,
          confirmedFinalQty: item.finalQty,
          snapshotSource: 'LIVE',
        },
      })
    }

    await tx.reorderPlan.update({
      where: { id: planId },
      data: {
        status: 'FINALIZED',
        confirmedAt,
        finalizedAt: confirmedAt, // 레거시 호환
      },
    })
  })

  return NextResponse.json({
    planId,
    status: 'FINALIZED',
    confirmedAt,
  })
}
