// 지원자 stage 일괄 변경 — 쓰기 권한(hiring-applicants) + spaceId 스코프.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { bulkStageSchema } from '@/lib/validations/hiring-applicants'

export async function PATCH(req: NextRequest) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => null)
  const parsed = bulkStageSchema.safeParse(body)
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)

  // spaceId 스코프로 제한 — 다른 공간의 지원서는 절대 변경되지 않는다.
  const result = await prisma.hiringApplication.updateMany({
    where: { id: { in: parsed.data.ids }, spaceId: resolved.space.id, deletedAt: null },
    data: { stage: parsed.data.stage },
  })

  return NextResponse.json({ ok: true, updated: result.count })
}
