// POST /api/sh/inventory/reorder/plan/[planId]/accuracy/recompute
// 연결된 ProductionRun.stockedInAt 기준으로 적중률 일괄 계산
// → ReorderPlanAccuracy upsert, plan.status = CONSUMED
//
// 전제: 계획이 FINALIZED 상태이고 연결된 ProductionRun에 stockedInAt이 있어야 함.
// 정산 코어 로직은 settle-accuracy.ts 와 공유(발주 계획 생성 시 lazy 정산도 동일 함수 사용).

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { settlePlanAccuracy } from '@/lib/inv/forecast/settle-accuracy'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { planId } = await params

  const result = await settlePlanAccuracy(planId, spaceId)

  if (!result.ok) {
    switch (result.reason) {
      case 'NOT_FOUND':
        return errorResponse('발주 계획을 찾을 수 없습니다', 404)
      case 'NOT_FINALIZED':
        return errorResponse('FINALIZED 상태의 계획만 적중률 계산이 가능합니다', 409)
      case 'NO_STOCKED_IN':
        return errorResponse('입고 완료(stockedInAt)된 ProductionRun이 없습니다', 400)
    }
  }

  return NextResponse.json({
    planId: result.planId,
    status: 'CONSUMED',
    evaluatedAt: result.evaluatedAt,
    accuracies: result.accuracies,
  })
}
