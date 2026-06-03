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
      case 'NOT_CONFIRMED':
        return errorResponse('예측 검증을 시작한(확정·미대체) 계획만 적중률 계산이 가능합니다', 409)
      case 'WINDOW_NOT_ELAPSED':
        return errorResponse('아직 평가 기간(확정 + 리드타임)이 경과한 옵션이 없습니다', 400)
    }
  }

  return NextResponse.json({
    planId: result.planId,
    evaluatedAt: result.evaluatedAt,
    accuracies: result.accuracies,
  })
}
