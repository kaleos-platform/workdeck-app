import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'

export const runtime = 'nodejs'
const MAX_ATTEMPTS = 50
const DEADLINE_MS = 1500

export const GET = withCronRun('/api/cron/hiring-upload-backfill', async () => {
  let progress: { scanned: number; failed: number; deadline_reached: boolean } | null = null
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '3s'`
      return tx.$queryRaw<Array<{
        scanned: number; failed: number; deadline_reached: boolean
      }>>`SELECT * FROM public.hiring_run_upload_backfill(${MAX_ATTEMPTS}, ${DEADLINE_MS})`
    }, { timeout: 5_000 })
    progress = result[0]
    const stats = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '3s'`
      return tx.$queryRaw<Array<{ remaining: number; deferred: number; unverified: number; quarantined: number }>>`
        SELECT * FROM public.hiring_upload_backfill_stats()
      `
    }, { timeout: 5_000 })
    const counts = stats[0]
    // complete는 현존 세션의 이관 집계이며 과거 삭제 자료나 Storage 정리 완료를 뜻하지 않는다.
    const completion = progress.deadline_reached || counts.remaining > 0 ? 'pending' :
      counts.unverified > 0 || counts.quarantined > 0 ? 'review_required' : 'complete'
    return { status: progress.failed ? 'partial' : 'ok', completion, ...progress, ...counts }
  } catch {
    // DB 오류 원문을 HTTP 응답이나 실행 이력에 기록하지 않는다.
    return { status: 'unavailable', completion: 'unknown', scanned: progress?.scanned ?? null, failed: progress?.failed ?? null,
      remaining: null, deferred: null, unverified: null, quarantined: null, deadline_reached: progress?.deadline_reached ?? null }
  }
}, 'cron-secret', (detail) => detail.status === 'ok' && detail.completion === 'complete')
