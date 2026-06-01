// PATCH /api/sh/inventory/options/safety-stock
// 옵션 안전재고 일괄 수정 — 선택 옵션 N건을 한 번에 동일 값으로 설정.
//
// 바디: { optionIds: string[], safetyStockQty: number }
// 스코프: product.spaceId 로 테넌트 격리 (단건 라우트 options/[optionId]/safety-stock 와 동일).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const BulkSafetyStockSchema = z.object({
  optionIds: z.array(z.string()).min(1),
  safetyStockQty: z.number().int().min(0),
})

export async function PATCH(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id

  let body: z.infer<typeof BulkSafetyStockSchema>
  try {
    body = BulkSafetyStockSchema.parse(await req.json())
  } catch (e) {
    return errorResponse('요청 데이터가 유효하지 않습니다', 400, { detail: String(e) })
  }

  // product.spaceId 스코프로 갱신 (다른 테넌트 옵션 ID 주입 방어)
  const updated = await prisma.invProductOption.updateMany({
    where: { id: { in: body.optionIds }, product: { spaceId } },
    data: { safetyStockQty: body.safetyStockQty },
  })

  return NextResponse.json({
    updatedCount: updated.count,
    safetyStockQty: body.safetyStockQty,
  })
}
