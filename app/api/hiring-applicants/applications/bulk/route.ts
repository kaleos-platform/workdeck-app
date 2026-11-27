// 지원자 stage 일괄 변경 — 쓰기 권한(hiring-applicants) + spaceId 스코프.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, errorResponse, assertRole } from '@/lib/api-helpers'
import { deleteApplications, MigrationInProgressError } from '@/lib/hiring/delete'
import { bulkDeleteSchema, bulkStageSchema } from '@/lib/validations/hiring-applicants'

export async function PATCH(req: NextRequest) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
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

// 지원자 일괄 완전 삭제 — OWNER/ADMIN 만. 다른 공간 id 는 조용히 제외된다.
export async function DELETE(req: NextRequest) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error
  const roleError = assertRole(resolved.role, 'ADMIN')
  if (roleError) return roleError

  const body = await req.json().catch(() => null)
  const parsed = bulkDeleteSchema.safeParse(body)
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)

  let deleted: number
  try {
    deleted = await deleteApplications(resolved.space.id, parsed.data.ids)
  } catch (e) {
    if (e instanceof MigrationInProgressError) return errorResponse(e.message, 409)
    throw e
  }
  return NextResponse.json({ deleted })
}
