// 지원서 단건 수정(stage/hiringStage/memo) — 쓰기 권한 + spaceId 스코프(IDOR 방어).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { updateApplicationSchema } from '@/lib/validations/hiring-applicants'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('hiring-applicants')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = updateApplicationSchema.safeParse(body)
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)

  // 소유 검증 — 다른 공간 지원서 접근 차단
  const app = await prisma.hiringApplication.findFirst({
    where: { id, spaceId: resolved.space.id, deletedAt: null },
    select: { id: true },
  })
  if (!app) return errorResponse('지원서를 찾을 수 없습니다', 404)

  await prisma.hiringApplication.update({
    where: { id },
    data: {
      ...(parsed.data.stage !== undefined ? { stage: parsed.data.stage } : {}),
      ...(parsed.data.hiringStage !== undefined ? { hiringStage: parsed.data.hiringStage } : {}),
      ...(parsed.data.memo !== undefined ? { memo: parsed.data.memo } : {}),
    },
  })

  return NextResponse.json({ ok: true })
}
