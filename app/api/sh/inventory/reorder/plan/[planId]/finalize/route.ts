// POST /api/sh/inventory/reorder/plan/[planId]/finalize
// DRAFT → FINALIZED 전환
//
// 흐름:
//  1) DRAFT 확인
//  2) finalQty > 0 아이템을 brandId별로 groupBy
//  3) 브랜드별 ProductionRun(PLANNED) 생성 + ProductionRunItem 채움
//  4) reorderPlanId 세팅, plan.finalizedAt = now, status = FINALIZED
//  모두 단일 트랜잭션

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// ─── runNo 생성 (yyyyMMdd-NNN, space 전체 범위) ────────────────────────────────

async function generateRunNo(
  spaceId: string,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<string> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const y = today.getFullYear()
  const mo = String(today.getMonth() + 1).padStart(2, '0')
  const dy = String(today.getDate()).padStart(2, '0')
  const dateStr = `${y}${mo}${dy}`

  const count = await tx.productionRun.count({
    where: { spaceId, createdAt: { gte: today } },
  })

  return `${dateStr}-${String(count + 1).padStart(3, '0')}`
}

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
        where: { finalQty: { gt: 0 } },
        select: {
          id: true,
          optionId: true,
          finalQty: true,
          product: { select: { brandId: true } },
        },
      },
    },
  })

  if (!plan || plan.spaceId !== spaceId) {
    return errorResponse('발주 계획을 찾을 수 없습니다', 404)
  }
  if (plan.status !== 'DRAFT') {
    return errorResponse('DRAFT 상태의 계획만 확정할 수 있습니다', 409)
  }
  if (plan.items.length === 0) {
    return errorResponse('확정 수량(finalQty > 0)이 있는 아이템이 없습니다', 400)
  }

  // brandId별 그룹핑 (null brandId는 'NO_BRAND' 키로 그룹)
  const brandGroups = new Map<string | null, typeof plan.items>()
  for (const item of plan.items) {
    const brandId = item.product.brandId ?? null
    const group = brandGroups.get(brandId) ?? []
    group.push(item)
    brandGroups.set(brandId, group)
  }

  const finalizedAt = new Date()

  const productionRuns = await prisma.$transaction(async (tx) => {
    const runs: { id: string; runNo: string; brandId: string | null }[] = []
    let runCounter = 0

    for (const [brandId, items] of brandGroups.entries()) {
      // runNo 충돌 방지: 같은 트랜잭션 내에서 순번 보장
      const baseRunNo = await generateRunNo(spaceId, tx)
      // 같은 날 여러 run이 생성될 때를 위해 counter 오프셋
      const runNo =
        runCounter === 0
          ? baseRunNo
          : baseRunNo.replace(
              /-(\d{3})$/,
              `-${String(parseInt(baseRunNo.match(/-(\d{3})$/)?.[1] ?? '1') + runCounter).padStart(3, '0')}`
            )
      runCounter++

      const run = await tx.productionRun.create({
        data: {
          spaceId,
          brandId: brandId ?? null,
          runNo,
          status: 'PLANNED',
          reorderPlanId: planId,
          items: {
            create: items.map((item) => ({
              optionId: item.optionId,
              quantity: item.finalQty,
            })),
          },
        },
        select: { id: true, runNo: true, brandId: true },
      })
      runs.push(run)
    }

    // 계획 상태 전환
    await tx.reorderPlan.update({
      where: { id: planId },
      data: {
        status: 'FINALIZED',
        finalizedAt,
      },
    })

    return runs
  })

  return NextResponse.json({
    planId,
    status: 'FINALIZED',
    finalizedAt,
    productionRuns,
  })
}
