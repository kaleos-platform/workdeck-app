// PATCH /api/sh/inventory/reorder/plan/[planId]/items
// 발주 계획 아이템 일괄 finalQty / userNote 수정 (DRAFT 상태만)
//
// 바디: { itemIds: string[], finalQty?: number, userNote?: string }
// 단일 트랜잭션으로 updateMany + totalFinalQty 1회 재계산 (per-item 반복 호출의 경쟁 조건 회피)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const BulkPatchSchema = z.object({
  itemIds: z.array(z.string()).min(1),
  finalQty: z.number().int().min(0).optional(),
  userNote: z.string().max(500).nullable().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { planId } = await params

  // 계획 존재 + 소유 + 상태 확인
  const plan = await prisma.reorderPlan.findUnique({
    where: { id: planId },
    select: { id: true, spaceId: true, status: true },
  })

  if (!plan || plan.spaceId !== spaceId) {
    return errorResponse('발주 계획을 찾을 수 없습니다', 404)
  }
  if (plan.status !== 'DRAFT') {
    return errorResponse('DRAFT 상태의 계획만 수정할 수 있습니다', 409)
  }

  // Zod 검증
  let body: z.infer<typeof BulkPatchSchema>
  try {
    body = BulkPatchSchema.parse(await req.json())
  } catch (e) {
    return errorResponse('요청 데이터가 유효하지 않습니다', 400, { detail: String(e) })
  }

  if (body.finalQty === undefined && body.userNote === undefined) {
    return errorResponse('수정할 필드가 없습니다', 400)
  }

  const data: { finalQty?: number; userNote?: string | null } = {}
  if (body.finalQty !== undefined) data.finalQty = body.finalQty
  if (body.userNote !== undefined) data.userNote = body.userNote

  const result = await prisma.$transaction(async (tx) => {
    // 해당 plan에 속한 itemIds만 갱신 (다른 계획 아이템 ID 주입 방어)
    const updated = await tx.reorderPlanItem.updateMany({
      where: { planId, id: { in: body.itemIds } },
      data,
    })

    // totalFinalQty 1회 재계산
    const allItems = await tx.reorderPlanItem.findMany({
      where: { planId },
      select: { finalQty: true },
    })
    const totalFinalQty = allItems.reduce((s, i) => s + i.finalQty, 0)
    await tx.reorderPlan.update({
      where: { id: planId },
      data: { totalFinalQty },
    })

    return { updatedCount: updated.count, totalFinalQty }
  })

  return NextResponse.json(result)
}
