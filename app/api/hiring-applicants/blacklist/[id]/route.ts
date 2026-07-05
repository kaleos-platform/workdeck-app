// 블랙리스트 활성 토글/삭제 — 쓰기 권한 + spaceId 스코프.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { blacklistUpdateSchema } from '@/lib/validations/hiring-applicants'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('hiring-applicants')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = blacklistUpdateSchema.safeParse(body)
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)

  const result = await prisma.hiringBlacklist.updateMany({
    where: { id, spaceId: resolved.space.id },
    data: { isActive: parsed.data.isActive },
  })
  if (result.count === 0) return errorResponse('대상을 찾을 수 없습니다', 404)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('hiring-applicants')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const result = await prisma.hiringBlacklist.deleteMany({
    where: { id, spaceId: resolved.space.id },
  })
  if (result.count === 0) return errorResponse('대상을 찾을 수 없습니다', 404)
  return NextResponse.json({ ok: true })
}
