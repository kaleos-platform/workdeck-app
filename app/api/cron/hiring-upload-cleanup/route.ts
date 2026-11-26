import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'
import { removeCleanupFiles } from '@/lib/hiring/cleanup-storage'
import { processFileDeletions } from '@/lib/hiring/delete'

export const runtime = 'nodejs'

export const GET = withCronRun(
  '/api/cron/hiring-upload-cleanup',
  async () => {
    let referenced = 0
    let active = 0
    let quarantined = 0
    let blocked = 0
    let deleteCallsSucceeded = 0
    let failed = 0
    const deadline = Date.now() + 20_000
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        if (Date.now() >= deadline) break
        const jobs = await prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL statement_timeout = '2s'`
            return tx.$queryRaw<Array<{ outcome: string; token: string | null; paths: unknown }>>`
          SELECT * FROM public.hiring_claim_upload_cleanup()
        `
          },
          { timeout: 4_000 }
        )
        if (!jobs.length) break
        const job = jobs[0]
        if (job.outcome === 'referenced') {
          referenced++
          continue
        }
        if (job.outcome === 'active') {
          active++
          continue
        }
        if (job.outcome === 'quarantined') {
          quarantined++
          continue
        }
        if (job.outcome === 'blocked' || job.outcome === 'skipped_limit') {
          blocked++
          break
        }
        if (
          job.outcome !== 'retired' ||
          !job.token ||
          !Array.isArray(job.paths) ||
          !job.paths.every((path) => typeof path === 'string')
        )
          throw Error('invalid cleanup result')
        let succeeded = false
        try {
          await removeCleanupFiles(job.paths)
          succeeded = true
          deleteCallsSucceeded++
        } catch {
          failed++
        }
        const finished = await prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL statement_timeout = '2s'`
            return tx.$queryRaw<Array<{ finished: boolean }>>`
          SELECT public.hiring_finish_upload_cleanup(${job.token}::uuid, ${succeeded}) AS finished
        `
          },
          { timeout: 4_000 }
        )
        if (!finished[0]?.finished) throw Error('cleanup lease expired')
      }
      const stats = await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '2s'`
          return tx.$queryRaw<
            Array<{
              due: number
              lag_seconds: number
              quarantined_total: number
              failed_total: number
            }>
          >`
        SELECT * FROM public.hiring_upload_cleanup_stats()
      `
        },
        { timeout: 4_000 }
      )
      if (!stats[0]) throw Error('cleanup stats unavailable')
      // 삭제된 공고·지원자 첨부 원장 재시도(실패해도 기존 정리 결과에는 영향 없음, 건수만 기록)
      const fileDeletions = await processFileDeletions().catch(() => null)
      const fileDeletionFailed = fileDeletions ? fileDeletions.failed : 0
      return {
        status: failed || blocked || fileDeletionFailed ? 'partial' : 'ok',
        completion: 'pending',
        fileDeletionsProcessed: fileDeletions?.processed ?? null,
        fileDeletionsFailed: fileDeletions?.failed ?? null,
        referenced,
        active,
        quarantined,
        blocked,
        deleteCallsSucceeded,
        failed,
        ...stats[0],
      }
    } catch {
      // 파일 경로와 DB 또는 Storage 오류 원문을 기록하지 않는다.
      // 업로드 정리가 실패해도 삭제 원장 재시도는 계속한다.
      const fileDeletions = await processFileDeletions().catch(() => null)
      return {
        status: 'unavailable',
        completion: 'unknown',
        fileDeletionsProcessed: fileDeletions?.processed ?? null,
        fileDeletionsFailed: fileDeletions?.failed ?? null,
        referenced,
        active,
        quarantined,
        blocked,
        deleteCallsSucceeded,
        failed,
        due: null,
        lag_seconds: null,
        quarantined_total: null,
        failed_total: null,
      }
    }
  },
  'cron-secret',
  (detail) => detail.status === 'ok'
)
