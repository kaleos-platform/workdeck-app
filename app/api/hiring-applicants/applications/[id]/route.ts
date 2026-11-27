// 지원서 단건 수정(stage/hiringStage/memo) — 쓰기 권한 + spaceId 스코프(IDOR 방어).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, errorResponse, assertRole } from '@/lib/api-helpers'
import { deleteApplications, MigrationInProgressError } from '@/lib/hiring/delete'
import { updateApplicationSchema } from '@/lib/validations/hiring-applicants'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
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

// 지원자 완전 삭제 — OWNER/ADMIN 만, spaceId 스코프(없거나 다른 공간이면 404).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error
  const roleError = assertRole(resolved.role, 'ADMIN')
  if (roleError) return roleError
  const { id } = await params

  let deleted: number
  try {
    deleted = await deleteApplications(resolved.space.id, [id])
  } catch (e) {
    if (e instanceof MigrationInProgressError) return errorResponse(e.message, 409)
    throw e
  }
  if (!deleted) return errorResponse('지원서를 찾을 수 없습니다', 404)
  return NextResponse.json({ deleted })
}
