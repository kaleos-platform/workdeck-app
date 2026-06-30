// POST /api/sh/inventory/reorder/plan/[planId]/revert
// "초안으로" — FINALIZED 계획을 수정하기 위해 새 DRAFT revision 생성.
//
// 무결성 원칙(Codex): 확정 계획은 immutable. same-row 수정 금지.
//  1) 기존 FINALIZED 계획은 보존 + supersededAt/supersededByPlanId 마킹
//  2) 새 DRAFT 계획 생성 (새 planNo, sourcePlanId=원본, items를 현재 값으로 새로 복사)
//  3) 원본 accuracy는 삭제하지 않고 validity=SUPERSEDED
//  4) 생산차수는 원본에 연결된 채 유지 (재고 전용, revision과 무관)
//  단일 트랜잭션. 새 계획 id 반환 → 프론트가 그 상세로 이동.

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { generatePlanNo } from '@/lib/inv/reorder-seq'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { planId } = await params

  const plan = await prisma.reorderPlan.findUnique({
    where: { id: planId },
    include: {
      items: true,
      sets: true, // 세트(위치/레이어드) 계획의 세트 라인 — 새 DRAFT로 복사해 세트 편집 보존
    },
  })

  if (!plan || plan.spaceId !== spaceId) {
    return errorResponse('발주 계획을 찾을 수 없습니다', 404)
  }
  if (plan.status !== 'FINALIZED') {
    return errorResponse('확정(FINALIZED) 상태의 계획만 초안으로 되돌릴 수 있습니다', 409)
  }
  if (plan.supersededAt) {
    return errorResponse('이미 다른 버전으로 대체된 계획입니다', 409)
  }

  const newPlan = await prisma.$transaction(async (tx) => {
    const planNo = await generatePlanNo(spaceId, tx)

    // 새 DRAFT revision — 현재 값으로 items 새로 복사 (confirmed* 스냅샷은 복사 안 함: 새 초안)
    const created = await tx.reorderPlan.create({
      data: {
        spaceId,
        planNo,
        status: 'DRAFT',
        windowDays: plan.windowDays,
        createdById: plan.createdById,
        productId: plan.productId,
        locationId: plan.locationId, // 위치 세트/레이어드 계획의 대상 위치 보존 (누락 시 평이 상품 플랜으로 강등)
        sourcePlanId: plan.id,
        biasAdjustApplied: plan.biasAdjustApplied ?? undefined,
        totalSuggestedQty: plan.totalSuggestedQty,
        totalFinalQty: plan.totalFinalQty,
        memo: plan.memo,
        items: {
          create: plan.items.map((it) => ({
            optionId: it.optionId,
            productId: it.productId,
            currentStock: it.currentStock,
            dailyAvgForecast: it.dailyAvgForecast,
            forecastModel: it.forecastModel,
            leadTimeDays: it.leadTimeDays,
            safetyStockQty: it.safetyStockQty,
            suggestedQty: it.suggestedQty,
            roundedSuggestedQty: it.roundedSuggestedQty,
            finalQty: it.finalQty,
            roundUnit: it.roundUnit,
            rationale: it.rationale,
            userNote: it.userNote,
            biasAdjustFactor: it.biasAdjustFactor,
            confidenceScore: it.confidenceScore,
            inputsSnapshot: it.inputsSnapshot ?? {},
            directGrossQty: it.directGrossQty, // 레이어드 직접 GROSS 보존 (세트 PATCH 재계산용)
          })),
        },
        // 세트 라인 복사 — 없으면 revert 후 세트 레이어 소실(세트 편집 불가)
        sets: {
          create: plan.sets.map((s) => ({
            listingId: s.listingId,
            listingName: s.listingName,
            currentSetStock: s.currentSetStock,
            suggestedSetQty: s.suggestedSetQty,
            finalSetQty: s.finalSetQty,
            sortOrder: s.sortOrder,
          })),
        },
      },
      select: { id: true, planNo: true },
    })

    // 원본 보존 + supersede 마킹
    await tx.reorderPlan.update({
      where: { id: plan.id },
      data: { supersededAt: new Date(), supersededByPlanId: created.id },
    })

    // 원본 accuracy 무효화 (삭제 금지 — 학습 이력 추적 유지)
    await tx.reorderPlanAccuracy.updateMany({
      where: { planId: plan.id, validity: 'ACTIVE' },
      data: { validity: 'SUPERSEDED', evaluationStatus: 'INVALIDATED' },
    })

    return created
  })

  return NextResponse.json({ planId: newPlan.id, planNo: newPlan.planNo, sourcePlanId: planId })
}
