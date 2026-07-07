import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { postingPositionSchema } from '@/lib/validations/hiring-posts'

type Params = { params: Promise<{ id: string; positionId: string }> }

// 공고 직무 수정
export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id, positionId } = await params

  // 공고 소속 + 직무 소속 동시 검증 (cross-space 방지)
  const existing = await prisma.hiringPostingPosition.findFirst({
    where: { id: positionId, postingId: id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('직무를 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = postingPositionSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  if (parsed.data.positionId) {
    const linked = await prisma.hiringPosition.findFirst({
      where: { id: parsed.data.positionId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!linked) return errorResponse('직무 기준정보를 찾을 수 없습니다', 404)
  }

  const { positionId: linkId, workDays, ...rest } = parsed.data
  const position = await prisma.hiringPostingPosition.update({
    where: { id: positionId },
    data: {
      positionId: linkId ?? null,
      workDays: workDays ?? undefined,
      ...rest,
    },
  })
  return NextResponse.json({ position })
}

// 공고 직무 삭제
export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id, positionId } = await params

  const existing = await prisma.hiringPostingPosition.findFirst({
    where: { id: positionId, postingId: id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('직무를 찾을 수 없습니다', 404)

  await prisma.hiringPostingPosition.delete({ where: { id: positionId } })
  return NextResponse.json({ ok: true })
}
