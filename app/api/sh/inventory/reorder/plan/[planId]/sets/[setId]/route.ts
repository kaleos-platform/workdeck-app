// PATCH /api/sh/inventory/reorder/plan/[planId]/sets/[setId]
// 세트 발주 계획의 세트 라인은 옵션 발주수량의 역산 표시(파생)라 세트 단위로 편집할 수 없다.
// 위치·레이어드 두 세트 모드 모두 옵션 수요가 진실이고, 세트를 되먹여 사이징하면 중복/부분겹침
// 세트의 공유 옵션이 ×N 과다집계되므로(옵션 중심 통일) 이 엔드포인트는 409 를 반환한다.
// 수량 조정은 옵션 최종수량(FinalQtyCell)에서 한다.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

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

  // body 는 스키마 검증만 하고 사용하지 않는다(세트 편집 자체를 거부). 잘못된 payload 는 400 유지.
  void body

  const plan = await prisma.reorderPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      spaceId: true,
      status: true,
      sets: { select: { id: true } },
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

  // 세트 라인은 옵션 발주수량의 역산 표시(파생) — 위치·레이어드 두 모드 모두 세트 단위 편집 불가.
  return errorResponse(
    '세트는 옵션 발주수량의 역산 표시라 세트 단위로 편집할 수 없습니다. 옵션 최종수량을 수정하세요.',
    409
  )
}
