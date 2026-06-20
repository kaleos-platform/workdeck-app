import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productDisplayName } from '@/lib/sh/product-display'

// 홈 대시보드 "발주 계획" 카드 — 초안 발주 + 예측 검증 결과.
//
// 초안(DRAFT, 미대체): 사용자가 검토·확정해야 할 발주 계획.
// 예측 검증(ReorderPlanAccuracy):
//   - ELIGIBLE: 평가창 경과 — 정산 대기 (사용자가 점검할 수 있음, 액션 측면). 시간 무관 전체.
//   - MEASURED: 정산 완료 — 정확도(WAPE/bias) 산출됨 (결과 확인 측면). 최근 결과만
//     (영구 누적 방지 — "지금 확인할 결과"가 의도).
// accuracy 는 옵션 단위 레코드이므로 발주 계획(planId) 단위로 집계한다.

const RECENT_MEASURED_DAYS = 14

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const recentCutoff = new Date(Date.now() - RECENT_MEASURED_DAYS * 24 * 60 * 60 * 1000)

  const [draftPlans, accuracyRows] = await Promise.all([
    // 초안 발주 계획 (미대체)
    prisma.reorderPlan.findMany({
      where: { spaceId, status: 'DRAFT', supersededAt: null },
      select: {
        id: true,
        planNo: true,
        createdAt: true,
        product: { select: { name: true, internalName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    // 유효(ACTIVE) accuracy 레코드 — 옵션 단위. 계획 단위 집계용.
    // ELIGIBLE 은 전체(정산 대기), MEASURED 는 최근만(결과 확인).
    prisma.reorderPlanAccuracy.findMany({
      where: {
        plan: { spaceId },
        validity: 'ACTIVE',
        OR: [
          { evaluationStatus: 'ELIGIBLE' },
          { evaluationStatus: 'MEASURED', evaluatedAt: { gte: recentCutoff } },
        ],
      },
      select: { planId: true, evaluationStatus: true, evaluatedAt: true },
    }),
  ])

  // 발주 계획(planId) 단위로 상태 롤업 — 한 계획에 ELIGIBLE/MEASURED 옵션이 섞이면
  // ELIGIBLE(정산 대기)을 우선 노출(액션 필요).
  const planStatus = new Map<string, { status: 'ELIGIBLE' | 'MEASURED'; evaluatedAt: Date }>()
  for (const r of accuracyRows) {
    const prev = planStatus.get(r.planId)
    if (!prev) {
      planStatus.set(r.planId, {
        status: r.evaluationStatus as 'ELIGIBLE' | 'MEASURED',
        evaluatedAt: r.evaluatedAt,
      })
    } else {
      // ELIGIBLE 이 하나라도 있으면 ELIGIBLE 로 격상
      if (r.evaluationStatus === 'ELIGIBLE') prev.status = 'ELIGIBLE'
      if (r.evaluatedAt > prev.evaluatedAt) prev.evaluatedAt = r.evaluatedAt
    }
  }

  let eligiblePlanCount = 0
  let measuredPlanCount = 0
  for (const v of planStatus.values()) {
    if (v.status === 'ELIGIBLE') eligiblePlanCount += 1
    else measuredPlanCount += 1
  }

  const draftSamples = draftPlans.slice(0, 5).map((p) => ({
    planId: p.id,
    planNo: p.planNo,
    productName: p.product ? productDisplayName(p.product) : '전체 계획',
  }))

  return NextResponse.json({
    draftPlanCount: draftPlans.length,
    draftSamples,
    eligiblePlanCount,
    measuredPlanCount,
  })
}
