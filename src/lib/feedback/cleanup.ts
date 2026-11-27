import 'server-only'
import { prisma } from '@/lib/prisma'
import { removeFeedbackFiles } from '@/lib/feedback/storage'
import { DAY_MS, RETENTION_DAYS } from '@/lib/feedback/policy'

class RestoreMismatch extends Error {}

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
    // 선점과 원장 기록을 한 transaction으로: 도중에 죽어도 경로는 항상 DB(원장)에 남는다
    const groups = await prisma.$transaction(async (tx) => {
      const claim = await tx.userFeedbackAttachment.updateMany({
        where: { id: { in: ids }, deletedAt: null, feedback },
        data: { deletedAt: now },
      })
      if (!claim.count) return []
      const claimed = await tx.userFeedbackAttachment.findMany({
        where: { id: { in: ids }, deletedAt: now },
        select: { id: true, feedbackId: true, path: true, sizeBytes: true },
      })
      const byFeedback = new Map<string, typeof claimed>()
      for (const a of claimed)
        byFeedback.set(a.feedbackId, [...(byFeedback.get(a.feedbackId) ?? []), a])
      const out: { ledgerId: string; items: typeof claimed }[] = []
      for (const items of byFeedback.values()) {
        const row = await tx.feedbackFileDeletion.create({
          data: {
            paths: items.map((a) => a.path),
            bytes: items.reduce((n, a) => n + a.sizeBytes, 0),
          },
        })
        out.push({ ledgerId: row.id, items })
      }
      return out
    })
    for (const { ledgerId, items } of groups) {
      let failed: string[]
      let removed: string[]
      try {
        ;({ removed, failed } = await removeFeedbackFiles(items.map((a) => a.path)))
      } catch {
        removed = []
        failed = items.map((a) => a.path)
      }
      expiredRemoved += removed.length
      expiredFailed += failed.length
      if (!failed.length) {
        await prisma.feedbackFileDeletion.delete({ where: { id: ledgerId } })
      } else {
        // 되돌릴 행이 줄었으면(탈퇴 cascade 등) 복구를 롤백하고 원장만 남겨 원장 루프가 재시도한다
        await prisma
          .$transaction(async (tx) => {
            const failedIds = items.filter((a) => failed.includes(a.path)).map((a) => a.id)
            const restored = await tx.userFeedbackAttachment.updateMany({
              where: { id: { in: failedIds } },
              data: { deletedAt: null },
            })
            if (restored.count !== failedIds.length) throw new RestoreMismatch()
            await tx.feedbackFileDeletion.delete({ where: { id: ledgerId } })
          })
          .catch((e) => {
            if (!(e instanceof RestoreMismatch)) throw e
          })
      }
    }
  }

  let ledgerDone = 0
  let ledgerFailed = 0
  const rows = await prisma.feedbackFileDeletion.findMany({
    where: { createdAt: { lt: new Date(now.getTime() - LEDGER_GRACE_MS) } },
    orderBy: [{ attempts: 'asc' }, { createdAt: 'asc' }],
    take: batch,
  })
  for (const row of rows) {
    const paths = Array.isArray(row.paths)
      ? row.paths.filter((p): p is string => typeof p === 'string')
      : []
    let failed: string[]
    try {
      ;({ failed } = await removeFeedbackFiles(paths))
    } catch {
      failed = paths.length ? paths : ['?']
    }
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
