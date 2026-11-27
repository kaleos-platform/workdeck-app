import { NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { assertFeedbackBucket, removeFeedbackFiles, signFeedbackFile } from '@/lib/feedback/storage'
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
  // 버킷 설정이 틀리면 서명하지 않는다(fail closed)
  const bucketOk = await assertFeedbackBucket().then(
    () => true,
    () => false
  )
  return NextResponse.json(
    await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        url: r.deletedAt || !bucketOk ? null : await signFeedbackFile(r.path).catch(() => null),
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        deletedAt: r.deletedAt,
      }))
    )
  )
}

// DELETE — cron과 같은 순서: 선점+원장+감사 로그(한 tx) → Storage 삭제 → 성공 시 원장 삭제, 실패 시 원장 유지(cron 재시도)
export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  const { id } = await params
  if (!(await prisma.userFeedback.findUnique({ where: { id }, select: { id: true } })))
    return errorResponse(NOT_FOUND, 404)

  const now = new Date()
  const { rows, ledger } = await prisma.$transaction(async (tx) => {
    const marked = await tx.userFeedbackAttachment.updateMany({
      where: { feedbackId: id, deletedAt: null },
      data: { deletedAt: now },
    })
    const rows = marked.count
      ? await tx.userFeedbackAttachment.findMany({
          where: { feedbackId: id, deletedAt: now },
          select: { path: true, sizeBytes: true },
        })
      : []
    const ledger = rows.length
      ? await tx.feedbackFileDeletion.create({
          data: {
            paths: rows.map((a) => a.path),
            bytes: rows.reduce((n, a) => n + a.sizeBytes, 0),
          },
          select: { id: true },
        })
      : null
    await writeAuditLog(
      auth.user.id,
      'userFeedback.attachmentsDelete',
      'userFeedback',
      id,
      { count: rows.length },
      tx
    )
    return { rows, ledger }
  })
  const result = { removed: 0, failed: 0 }
  if (ledger) {
    let failed: string[]
    try {
      ;({ failed } = await removeFeedbackFiles(rows.map((a) => a.path)))
    } catch {
      failed = rows.map((a) => a.path)
    }
    result.failed = failed.length
    result.removed = rows.length - failed.length
    if (!failed.length)
      await prisma.feedbackFileDeletion.delete({ where: { id: ledger.id } }).catch(() => null)
  }
  return NextResponse.json(result)
}
