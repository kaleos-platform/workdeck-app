// 공고·지원자 완전 삭제. DB 삭제와 같은 트랜잭션에서 Storage 삭제 경로를 원장(HiringFileDeletion)에 남기고,
// 커밋 후 즉시 삭제를 시도한다. 실패분은 cron(processFileDeletions)이 재시도한다.
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { getPostingDisplayStatus } from './posting-status'
import { removeCleanupFiles } from './cleanup-storage'

const PATH_CHUNK = 100

export const MIGRATION_IN_PROGRESS_MESSAGE =
  '오프닝에서 이전 중인 데이터라 이전이 끝난 뒤 삭제할 수 있어요.'

/** 이전이 끝나지 않은 공간의 이관 데이터 삭제 시도. 라우트에서 409로 바꾼다. */
export class MigrationInProgressError extends Error {
  constructor() {
    super(MIGRATION_IN_PROGRESS_MESSAGE)
  }
}

// 이전 완료 = 그 공간의 오프닝 이전 작업이 모두 종료 상태이고, 하나 이상이 실제 적용(DONE·GRANT_MANUAL)됐다.
// 진행 중에는 이전 감사·재계획이 원장을 다시 읽으므로 삭제(tombstone)를 막는다.
const TERMINAL_JOB = ['DONE', 'GRANT_MANUAL', 'HELD', 'FAILED']
const APPLIED_JOB = ['DONE', 'GRANT_MANUAL']

async function assertMigrationSettled(
  tx: Prisma.TransactionClient,
  spaceId: string,
  targets: { targetModel: 'HiringPosting' | 'HiringApplication'; ids: string[] }[]
) {
  const migrated = await tx.hiringMigrationRecord.findFirst({
    where: {
      spaceId,
      OR: targets
        .filter((t) => t.ids.length)
        .map((t) => ({ targetModel: t.targetModel, targetId: { in: t.ids } })),
    },
    select: { id: true },
  })
  if (!migrated) return
  const jobs = await tx.openingMigrationJob.findMany({
    where: { targetSpaceId: spaceId },
    select: { status: true },
  })
  const settled =
    jobs.every((j) => TERMINAL_JOB.includes(j.status)) &&
    jobs.some((j) => APPLIED_JOB.includes(j.status))
  if (!settled) throw new MigrationInProgressError()
}

export type DeletePostingResult =
  | { status: 'ok'; deletedApplications: number }
  | { status: 'not_found' }
  | { status: 'open' }

function sessionPaths(files: unknown): string[] {
  if (!Array.isArray(files)) return []
  return files.flatMap((f) =>
    f && typeof (f as { path?: unknown }).path === 'string' ? [(f as { path: string }).path] : []
  )
}

// 이관 원장의 암호화 원본 사본을 비운다(행은 남겨 재이관 시 되살아나지 않게 한다).
async function tombstoneMigrationRecords(
  tx: Prisma.TransactionClient,
  spaceId: string,
  targetModel: 'HiringPosting' | 'HiringApplication',
  targetIds: string[]
) {
  if (!targetIds.length) return
  await tx.$executeRaw`
    UPDATE "HiringMigrationRecord"
    SET "sourceSnapshotEnc" = NULL, "sourceSnapshotIv" = NULL,
        "metadata" = (CASE WHEN jsonb_typeof("metadata") = 'object' THEN "metadata" ELSE '{}'::jsonb END) || jsonb_build_object('deletedAt', ${new Date().toISOString()}::text)
    WHERE "spaceId" = ${spaceId} AND "targetModel" = ${targetModel} AND "targetId" = ANY(${targetIds}::text[])`
}

async function recordFileDeletions(tx: Prisma.TransactionClient, spaceId: string, paths: string[]) {
  const unique = [...new Set(paths)]
  const ids: string[] = []
  for (let i = 0; i < unique.length; i += PATH_CHUNK) {
    const row = await tx.hiringFileDeletion.create({
      data: { spaceId, paths: unique.slice(i, i + PATH_CHUNK) },
      select: { id: true },
    })
    ids.push(row.id)
  }
  return ids
}

// 한 원장 행 처리. 성공하면 행 삭제, 실패하면 attempts+1(오류 원문·경로는 남기지 않는다).
async function processRow(row: { id: string; paths: unknown }): Promise<boolean> {
  try {
    const paths = Array.isArray(row.paths)
      ? row.paths.filter((p): p is string => typeof p === 'string')
      : []
    await removeCleanupFiles(paths)
    // 즉시 시도와 cron 이 겹쳐 행이 이미 없어도 성공으로 본다.
    await prisma.hiringFileDeletion.deleteMany({ where: { id: row.id } })
    return true
  } catch {
    await prisma.hiringFileDeletion
      .update({
        where: { id: row.id },
        data: { attempts: { increment: 1 }, lastError: 'storage remove failed' },
      })
      .catch(() => undefined)
    return false
  }
}

async function runLedgerRows(ids: string[]) {
  try {
    const rows = await prisma.hiringFileDeletion.findMany({ where: { id: { in: ids } } })
    for (const row of rows) await processRow(row)
  } catch {
    // 즉시 삭제 실패는 호출자에게 전파하지 않는다 — cron 이 이어서 처리한다.
  }
}

export async function deletePosting(
  spaceId: string,
  postingId: string
): Promise<DeletePostingResult> {
  const result = await prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "HiringPosting" WHERE id = ${postingId} AND "spaceId" = ${spaceId} FOR UPDATE`
      if (!locked.length) return { status: 'not_found' as const }
      const posting = await tx.hiringPosting.findUniqueOrThrow({
        where: { id: postingId },
        select: { status: true, closingDate: true },
      })
      if (getPostingDisplayStatus(posting.status, posting.closingDate) === 'OPEN')
        return { status: 'open' as const }

      const applications = await tx.hiringApplication.findMany({
        where: { postingId, spaceId },
        select: { id: true },
      })
      await assertMigrationSettled(tx, spaceId, [
        { targetModel: 'HiringPosting', ids: [postingId] },
        { targetModel: 'HiringApplication', ids: applications.map((a) => a.id) },
      ])
      const files = await tx.hiringApplicationFile.findMany({
        where: { spaceId, application: { postingId } },
        select: { filePath: true },
      })
      // postingId 가 SetNull 된 옛 세션도 지원서 id 로 함께 찾는다.
      const sessions = await tx.hiringUploadSession.findMany({
        where: {
          spaceId,
          OR: [{ postingId }, { applicationId: { in: applications.map((a) => a.id) } }],
        },
        select: { id: true, files: true },
      })
      const paths = [
        ...files.map((f) => f.filePath),
        ...sessions.flatMap((s) => sessionPaths(s.files)),
      ]

      await tx.hiringUploadSession.deleteMany({ where: { id: { in: sessions.map((s) => s.id) } } })
      await tombstoneMigrationRecords(tx, spaceId, 'HiringPosting', [postingId])
      await tombstoneMigrationRecords(
        tx,
        spaceId,
        'HiringApplication',
        applications.map((a) => a.id)
      )
      await tx.hiringPosting.delete({ where: { id: postingId } })
      const ledgerIds = await recordFileDeletions(tx, spaceId, paths)
      return { status: 'ok' as const, deletedApplications: applications.length, ledgerIds }
    },
    { timeout: 30_000 }
  )
  if (result.status !== 'ok') return result
  await runLedgerRows(result.ledgerIds)
  return { status: 'ok', deletedApplications: result.deletedApplications }
}

/** 지원자 완전 삭제. 다른 space 의 id 는 조용히 제외하며 실제 삭제 수를 반환한다. */
export async function deleteApplications(spaceId: string, ids: string[]): Promise<number> {
  const result = await prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "HiringApplication" WHERE id = ANY(${ids}::text[]) AND "spaceId" = ${spaceId} FOR UPDATE`
      const targetIds = locked.map((r) => r.id)
      if (!targetIds.length) return { deleted: 0, ledgerIds: [] as string[] }
      await assertMigrationSettled(tx, spaceId, [
        { targetModel: 'HiringApplication', ids: targetIds },
      ])

      const files = await tx.hiringApplicationFile.findMany({
        where: { spaceId, applicationId: { in: targetIds } },
        select: { filePath: true },
      })
      const sessions = await tx.hiringUploadSession.findMany({
        where: { spaceId, applicationId: { in: targetIds } },
        select: { id: true, files: true },
      })
      const paths = [
        ...files.map((f) => f.filePath),
        ...sessions.flatMap((s) => sessionPaths(s.files)),
      ]

      await tx.hiringUploadSession.deleteMany({ where: { id: { in: sessions.map((s) => s.id) } } })
      await tombstoneMigrationRecords(tx, spaceId, 'HiringApplication', targetIds)
      const { count } = await tx.hiringApplication.deleteMany({
        where: { id: { in: targetIds }, spaceId },
      })
      const ledgerIds = await recordFileDeletions(tx, spaceId, paths)
      return { deleted: count, ledgerIds }
    },
    { timeout: 30_000 }
  )
  await runLedgerRows(result.ledgerIds)
  return result.deleted
}

/** cron 재시도 — 실패 적은 순·오래된 순 limit 건(영구 실패 행이 새 행을 막지 않게). 처리/실패 건수만 반환한다. */
export async function processFileDeletions(
  limit = 20
): Promise<{ processed: number; failed: number }> {
  const rows = await prisma.hiringFileDeletion.findMany({
    orderBy: [{ attempts: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  })
  let processed = 0
  let failed = 0
  for (const row of rows) {
    if (await processRow(row)) processed++
    else failed++
  }
  return { processed, failed }
}
