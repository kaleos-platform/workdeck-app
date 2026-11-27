import 'server-only'
import { prisma } from '@/lib/prisma'
import { removeFeedbackFiles } from '@/lib/feedback/storage'
import { DAY_MS, RETENTION_DAYS } from '@/lib/feedback/policy'

const LEDGER_GRACE_MS = 3_600_000 // 업로드 진행 중인 예약 행 보호
const STATUSES = ['DONE', 'ON_HOLD'] as const

/**
 * 보관 기간 지난 첨부 삭제 + 삭제 원장 재시도. 매 실행 bounded batch.
 * 만료분은 먼저 deletedAt으로 선점(상태·closedAt 조건 재확인)한 뒤 Storage 삭제, 실패분만 되돌려 다음 실행에 재시도.
 */
export async function runFeedbackCleanup(now: Date, batch = 100) {
  let expiredRemoved = 0
  let expiredFailed = 0
  let left = batch

  for (const status of STATUSES) {
    if (left <= 0) break
    const feedback = {
      status,
      closedAt: { lte: new Date(now.getTime() - RETENTION_DAYS[status]! * DAY_MS) },
    }
    const candidates = await prisma.userFeedbackAttachment.findMany({
      where: { deletedAt: null, feedback },
      select: { id: true },
      take: left,
    })
    left -= candidates.length
    if (!candidates.length) continue
    const ids = candidates.map((c) => c.id)
    const claim = await prisma.userFeedbackAttachment.updateMany({
      where: { id: { in: ids }, deletedAt: null, feedback },
      data: { deletedAt: now },
    })
    if (!claim.count) continue
    const claimed = await prisma.userFeedbackAttachment.findMany({
      where: { id: { in: ids }, deletedAt: now },
      select: { id: true, feedbackId: true, path: true },
    })
    const byFeedback = new Map<string, typeof claimed>()
    for (const a of claimed) byFeedback.set(a.feedbackId, [...(byFeedback.get(a.feedbackId) ?? []), a])
    for (const group of byFeedback.values()) {
      const { removed, failed } = await removeFeedbackFiles(group.map((a) => a.path))
      expiredRemoved += removed.length
      expiredFailed += failed.length
      if (failed.length) {
        await prisma.userFeedbackAttachment.updateMany({
          where: { id: { in: group.filter((a) => failed.includes(a.path)).map((a) => a.id) } },
          data: { deletedAt: null },
        })
      }
    }
  }

  let ledgerDone = 0
  let ledgerFailed = 0
  const rows = await prisma.feedbackFileDeletion.findMany({
    where: { createdAt: { lt: new Date(now.getTime() - LEDGER_GRACE_MS) } },
    orderBy: { createdAt: 'asc' },
    take: batch,
  })
  for (const row of rows) {
    const paths = Array.isArray(row.paths) ? row.paths.filter((p): p is string => typeof p === 'string') : []
    const { failed } = await removeFeedbackFiles(paths)
    if (!failed.length) {
      await prisma.feedbackFileDeletion.delete({ where: { id: row.id } })
      ledgerDone++
    } else {
      // 경로 원문은 기록하지 않는다
      await prisma.feedbackFileDeletion.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 }, lastError: 'storage remove failed' },
      })
      ledgerFailed++
    }
  }

  return { expiredRemoved, expiredFailed, ledgerDone, ledgerFailed }
}
