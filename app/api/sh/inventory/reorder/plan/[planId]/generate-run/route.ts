// POST /api/sh/inventory/reorder/plan/[planId]/generate-run
// 발주 계획 기반으로 생산차수(ProductionRun) 생성 — 반복 가능, 재고 수량 전용.
// 확정(예측 검증)과 분리: 신뢰도 측정과 무관.
//
// 동작:
//  1) 계획 로드 (상태 무관 — DRAFT/FINALIZED 모두 생성 가능)
//  2) 옵션별 "미발주 잔여 수량" = finalQty − 기존 생산차수 합계, 0 초과만 대상
//  3) brandId별 ProductionRun(PLANNED) + ProductionRunItem 생성
//  단일 트랜잭션. brandId별 분할 생성 가능(1:N).

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { generateRunNo } from '@/lib/inv/reorder-seq'

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
      items: {
        select: {
          optionId: true,
          finalQty: true,
          product: { select: { brandId: true } },
        },
      },
      // 이미 이 계획에서 생성된 생산차수의 옵션별 수량 합계 → 미발주 잔여 계산
      productionRuns: {
        select: { items: { select: { optionId: true, quantity: true } } },
      },
    },
  })

  if (!plan || plan.spaceId !== spaceId) {
    return errorResponse('발주 계획을 찾을 수 없습니다', 404)
  }

  // 옵션별 기존 발주 합계
  const orderedByOption = new Map<string, number>()
  for (const run of plan.productionRuns) {
    for (const ri of run.items) {
      orderedByOption.set(ri.optionId, (orderedByOption.get(ri.optionId) ?? 0) + ri.quantity)
    }
  }

  // 미발주 잔여 = finalQty − 기존 발주, 0 초과만
  type RunItem = { optionId: string; quantity: number; brandId: string | null }
  const pending: RunItem[] = []
  for (const item of plan.items) {
    const remaining = item.finalQty - (orderedByOption.get(item.optionId) ?? 0)
    if (remaining > 0) {
      pending.push({
        optionId: item.optionId,
        quantity: remaining,
        brandId: item.product.brandId ?? null,
      })
    }
  }

  if (pending.length === 0) {
    return errorResponse('미발주 잔여 수량이 없습니다 (이미 전량 생산차수 생성됨)', 400)
  }

  // brandId별 그룹핑
  const brandGroups = new Map<string | null, RunItem[]>()
  for (const it of pending) {
    const group = brandGroups.get(it.brandId) ?? []
    group.push(it)
    brandGroups.set(it.brandId, group)
  }

  const runs = await prisma.$transaction(async (tx) => {
    const created: { id: string; runNo: string; brandId: string | null }[] = []
    let offset = 0
    for (const [brandId, items] of brandGroups.entries()) {
      const runNo = await generateRunNo(spaceId, tx, offset)
      offset++
      const run = await tx.productionRun.create({
        data: {
          spaceId,
          brandId: brandId ?? null,
          runNo,
          status: 'PLANNED',
          reorderPlanId: planId,
          items: {
            create: items.map((it) => ({ optionId: it.optionId, quantity: it.quantity })),
          },
        },
        select: { id: true, runNo: true, brandId: true },
      })
      created.push(run)
    }
    return created
  })

  return NextResponse.json({ planId, productionRuns: runs })
}
