import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const STATUSES = ['ACTIVE', 'DISCONTINUED'] as const
type OptionStatus = (typeof STATUSES)[number]

// PATCH /api/sh/inventory/option-status
// { optionIds: string[], status: 'ACTIVE' | 'DISCONTINUED' } — 옵션 상태 일괄 변경.
// 단종(DISCONTINUED)은 생산·발주 대상에서 빠지고, 재고 0 이면 재고 현황에서 숨겨진다.
export async function PATCH(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error

  const body = (await req.json().catch(() => ({}))) as { optionIds?: unknown; status?: unknown }
  const optionIds = Array.isArray(body.optionIds)
    ? body.optionIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  const status = body.status as OptionStatus
  if (optionIds.length === 0) return errorResponse('optionIds가 필요합니다', 400)
  if (!STATUSES.includes(status)) return errorResponse('status가 올바르지 않습니다', 400)

  const { count } = await prisma.invProductOption.updateMany({
    where: { id: { in: optionIds }, deletedAt: null, product: { spaceId: resolved.space.id } },
    data: { status },
  })
  return NextResponse.json({ updated: count })
}
