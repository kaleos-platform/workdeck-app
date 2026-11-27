import { NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { removeFeedbackFiles, signFeedbackFile } from '@/lib/feedback/storage'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ id: string }> }
const NOT_FOUND = '의견을 찾을 수 없습니다'

// GET — 첨부 목록(미삭제 행만 600초 서명 URL, 삭제된 행은 url null)
export async function GET(_request: Request, { params }: Ctx) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  const { id } = await params
  if (!(await prisma.userFeedback.findUnique({ where: { id }, select: { id: true } })))
    return errorResponse(NOT_FOUND, 404)

  const rows = await prisma.userFeedbackAttachment.findMany({
    where: { feedbackId: id },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(
    await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        url: r.deletedAt ? null : await signFeedbackFile(r.path),
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        deletedAt: r.deletedAt,
      }))
    )
  )
}

// DELETE — 미삭제 첨부를 즉시 삭제(성공분만 deletedAt 기록)
export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  const { id } = await params
  if (!(await prisma.userFeedback.findUnique({ where: { id }, select: { id: true } })))
    return errorResponse(NOT_FOUND, 404)

  const live = await prisma.userFeedbackAttachment.findMany({
    where: { feedbackId: id, deletedAt: null },
    select: { path: true },
  })
  const { removed, failed } = await removeFeedbackFiles(live.map((a) => a.path))
  const result = { removed: removed.length, failed: failed.length }
  await prisma.$transaction(async (tx) => {
    if (removed.length > 0)
      await tx.userFeedbackAttachment.updateMany({
        where: { feedbackId: id, path: { in: removed }, deletedAt: null },
        data: { deletedAt: new Date() },
      })
    await writeAuditLog(auth.user.id, 'userFeedback.attachmentsDelete', 'userFeedback', id, result, tx)
  })
  return NextResponse.json(result)
}
