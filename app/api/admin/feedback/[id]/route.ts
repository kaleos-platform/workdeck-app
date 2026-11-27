import { NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { adminUpdateSchema, nextClosedAt } from '@/lib/feedback/policy'
import { prisma } from '@/lib/prisma'

// PATCH /api/admin/feedback/[id] — 의견 상태·메모 변경
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { id } = await params
  const parsed = adminUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || (parsed.data.status === undefined && parsed.data.memo === undefined))
    return errorResponse('잘못된 요청입니다', 400)
  const { status, memo } = parsed.data

  const feedback = await prisma.$transaction(async (tx) => {
    const current = await tx.userFeedback.findUnique({
      where: { id },
      select: { status: true, closedAt: true },
    })
    if (!current) return null
    const updated = await tx.userFeedback.update({
      where: { id },
      data: {
        status,
        memo,
        closedAt: nextClosedAt(current.status, status ?? current.status, current.closedAt, new Date()),
      },
    })
    await writeAuditLog(
      auth.user.id,
      'userFeedback.update',
      'userFeedback',
      id,
      { status, memoChanged: memo !== undefined },
      tx
    )
    return updated
  })
  if (!feedback) return errorResponse('의견을 찾을 수 없습니다', 404)
  return NextResponse.json(feedback)
}
