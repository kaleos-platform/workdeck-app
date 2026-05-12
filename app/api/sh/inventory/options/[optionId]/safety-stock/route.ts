import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * 옵션 단위 안전재고 편집 — 단일 진입점.
 * 재고 상태 판정(`InvProductOption.safetyStockQty`)에 사용.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ optionId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { optionId } = await params

  const option = await prisma.invProductOption.findFirst({
    where: { id: optionId, product: { spaceId: resolved.space.id } },
    select: { id: true },
  })
  if (!option) return errorResponse('옵션을 찾을 수 없습니다', 404)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return errorResponse('요청 본문이 유효한 JSON이 아닙니다', 400)
  }

  const raw = body.safetyStockQty
  if (raw === undefined || raw === null) {
    return errorResponse('safetyStockQty가 필요합니다', 400)
  }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    return errorResponse('safetyStockQty는 0 이상의 정수여야 합니다', 400)
  }
  const safetyStockQty = Math.trunc(n)

  const updated = await prisma.invProductOption.update({
    where: { id: optionId },
    data: { safetyStockQty },
    select: { id: true, safetyStockQty: true },
  })

  return NextResponse.json({
    optionId: updated.id,
    safetyStockQty: updated.safetyStockQty,
  })
}
