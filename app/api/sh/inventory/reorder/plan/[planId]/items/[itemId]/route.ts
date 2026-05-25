// PATCH /api/sh/inventory/reorder/plan/[planId]/items/[itemId]
// 발주 계획 아이템 finalQty / userNote 수정 (DRAFT 상태만)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const PatchItemSchema = z.object({
  finalQty: z.number().int().min(0).optional(),
  userNote: z.string().max(500).nullable().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string; itemId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { planId, itemId } = await params

  // 계획 존재 + 소유 확인
  const plan = await prisma.reorderPlan.findUnique({
    where: { id: planId },
    select: { id: true, spaceId: true, status: true, items: { select: { id: true } } },
  })

  if (!plan || plan.spaceId !== spaceId) {
    return errorResponse('발주 계획을 찾을 수 없습니다', 404)
  }
  if (plan.status !== 'DRAFT') {
    return errorResponse('DRAFT 상태의 계획만 수정할 수 있습니다', 409)
  }
  if (!plan.items.some((i) => i.id === itemId)) {
    return errorResponse('발주 계획 아이템을 찾을 수 없습니다', 404)
  }

  // Zod 검증
  let body: z.infer<typeof PatchItemSchema>
  try {
    body = PatchItemSchema.parse(await req.json())
  } catch (e) {
    return errorResponse('요청 데이터가 유효하지 않습니다', 400, { detail: String(e) })
  }

  if (body.finalQty === undefined && body.userNote === undefined) {
    return errorResponse('수정할 필드가 없습니다', 400)
  }

  // 아이템 업데이트
  const updated = await prisma.reorderPlanItem.update({
    where: { id: itemId },
    data: {
      ...(body.finalQty !== undefined && { finalQty: body.finalQty }),
      ...(body.userNote !== undefined && { userNote: body.userNote }),
    },
    select: {
      id: true,
      finalQty: true,
      userNote: true,
    },
  })

  // 계획 totalFinalQty 재계산
  const allItems = await prisma.reorderPlanItem.findMany({
    where: { planId },
    select: { finalQty: true },
  })
  const totalFinalQty = allItems.reduce((s, i) => s + i.finalQty, 0)
  await prisma.reorderPlan.update({
    where: { id: planId },
    data: { totalFinalQty },
  })

  return NextResponse.json(updated)
}
