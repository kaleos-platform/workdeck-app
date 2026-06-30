// PATCH /api/sh/inventory/reorder/plan/[planId]/sets/[setId]
// 세트 발주 계획의 세트 수량(finalSetQty) 수정 (DRAFT 상태만).
// 세트 수량을 바꾸면 전체 세트를 구성옵션으로 재분해해 옵션별 finalQty 를 세트-정합하게 다시 맞춘다.
// (한 옵션이 여러 세트에 속할 수 있어, 한 세트만 고쳐도 전 옵션 finalQty 를 재계산해야 한다.)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { decomposeSetsToOptions } from '@/lib/sh/set-plan-calc'

const PatchSetSchema = z.object({
  finalSetQty: z.number().int().min(0),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string; setId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { planId, setId } = await params

  let body: z.infer<typeof PatchSetSchema>
  try {
    body = PatchSetSchema.parse(await req.json())
  } catch (e) {
    return errorResponse('요청 데이터가 유효하지 않습니다', 400, { detail: String(e) })
  }

  const plan = await prisma.reorderPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      spaceId: true,
      status: true,
      sets: {
        select: {
          id: true,
          finalSetQty: true,
          listing: {
            select: { items: { select: { optionId: true, quantity: true } } },
          },
        },
      },
    },
  })

  if (!plan || plan.spaceId !== spaceId) {
    return errorResponse('발주 계획을 찾을 수 없습니다', 404)
  }
  if (plan.status !== 'DRAFT') {
    return errorResponse('DRAFT 상태의 계획만 수정할 수 있습니다', 409)
  }
  const target = plan.sets.find((s) => s.id === setId)
  if (!target) {
    return errorResponse('세트 라인을 찾을 수 없습니다', 404)
  }

  // 전체 세트(편집 반영) → 옵션별 finalQty 재분해
  const decomposed = decomposeSetsToOptions(
    plan.sets.map((s) => ({
      listingId: s.id,
      setQty: s.id === setId ? body.finalSetQty : s.finalSetQty,
      items: s.listing.items.map((it) => ({ optionId: it.optionId, perSet: it.quantity })),
    }))
  )

  const updatedAt = await prisma.$transaction(async (tx) => {
    await tx.reorderPlanSet.update({
      where: { id: setId },
      data: { finalSetQty: body.finalSetQty },
    })

    // 이 계획의 모든 옵션 라인 finalQty 를 분해값으로 갱신 (세트 미포함 옵션은 0)
    const items = await tx.reorderPlanItem.findMany({
      where: { planId },
      select: { id: true, optionId: true },
    })
    let totalFinalQty = 0
    for (const it of items) {
      const qty = decomposed.get(it.optionId) ?? 0
      totalFinalQty += qty
      await tx.reorderPlanItem.update({ where: { id: it.id }, data: { finalQty: qty } })
    }

    const updated = await tx.reorderPlan.update({
      where: { id: planId },
      data: { totalFinalQty },
      select: { updatedAt: true },
    })
    return { totalFinalQty, updatedAt: updated.updatedAt }
  })

  return NextResponse.json({
    setId,
    finalSetQty: body.finalSetQty,
    totalFinalQty: updatedAt.totalFinalQty,
    // 옵션별 갱신된 finalQty (UI 즉시 반영용)
    optionFinalQty: Object.fromEntries(decomposed),
  })
}
