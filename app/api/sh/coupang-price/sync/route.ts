import { NextResponse } from 'next/server'

import { assertRole, resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { requireCoupangWorkspaceId } from '@/lib/coupang/workspace-space'

/**
 * POST /api/sh/coupang-price/sync — 쿠팡 상품 수동 불러오기(PRODUCT_SYNC 잡).
 * cron 의 20시간 중복 판정은 cron 경로에만 둔다 — 수동은 진행 중 잡만 막는다
 * (v1 후속과제 "수동 재실행이 조용히 스킵됨" 해소).
 */
export async function POST() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  // 불러온 스냅샷이 매칭·가격 반영의 기준이 된다 — 매칭·반영 API 와 같은 ADMIN.
  const denied = assertRole(resolved.role, 'ADMIN')
  if (denied) return denied
  const spaceId = resolved.space.id

  let workspaceId: string
  try {
    workspaceId = await requireCoupangWorkspaceId(spaceId)
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : '쿠팡 연동이 없습니다', 400)
  }
  const running = await prisma.coupangWriteJob.findFirst({
    where: { workspaceId, kind: 'PRODUCT_SYNC', status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true },
  })
  if (running) return errorResponse('쿠팡 상품을 이미 불러오는 중입니다', 409)

  const job = await prisma.coupangWriteJob.create({
    data: { workspaceId, spaceId, kind: 'PRODUCT_SYNC', payload: {} },
    select: { id: true },
  })
  return NextResponse.json({ job: { id: job.id } }, { status: 201 })
}
