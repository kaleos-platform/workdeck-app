import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'
import { storedUploadFilesSchema } from '@/lib/hiring/upload-protocol'
import { removeApplicantFiles } from '@/lib/hiring/storage'

export const runtime = 'nodejs'

// 서명 URL(2시간)이 소멸한 뒤에만 지워 재업로드로 고아 파일이 생기는 것을 막는다.
const SAFE_AGE_MS = 3 * 60 * 60 * 1000
const BATCH_SIZE = 50

export const GET = withCronRun('/api/cron/hiring-upload-sweep', async () => {
  const now = new Date()
  const where = {
    completedAt: null,
    expiresAt: { lt: now },
    createdAt: { lt: new Date(now.getTime() - SAFE_AGE_MS) },
    OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) } }],
  }
  let deleted = 0
  let failed = 0
  let scanned = 0
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline && scanned < 500) {
    const sessions = await prisma.hiringUploadSession.findMany({
      where,
      orderBy: [{ claimedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      take: BATCH_SIZE,
    })
    if (!sessions.length) break
    for (const session of sessions) {
      if (Date.now() >= deadline) break
      scanned++
      try {
        const removed = await prisma.$transaction(
          async (tx) => {
            // 완료 처리와 같은 행 잠금을 사용한다. 실패하면 세션을 남겨 다음 실행에서 재시도한다.
            const locked = await tx.hiringUploadSession.updateMany({
              where: { ...where, id: session.id },
              data: { claimedAt: now },
            })
            if (!locked.count) return false
            const files = storedUploadFilesSchema.parse(session.files)
            if (
              files.some(
                (file) => !file.path.startsWith(`${session.spaceId}/applications/${session.id}/`)
              )
            )
              throw Error('invalid paths')
            const referenced = await tx.hiringApplicationFile.count({
              where: { filePath: { in: files.map((file) => file.path) } },
            })
            if (referenced) throw Error('referenced files')
            await removeApplicantFiles(files.map((file) => file.path))
            await tx.hiringUploadSession.delete({ where: { id: session.id } })
            return true
          },
          { timeout: 15000 }
        )
        if (removed) deleted++
      } catch {
        // 원본 파일명·경로·토큰을 실행 로그에 기록하지 않는다.
        failed++
        // 실패 항목은 한 시간 뒤 재시도하여 뒤의 정리 대상을 막지 않는다.
        await prisma.hiringUploadSession.updateMany({
          where: { ...where, id: session.id },
          data: { claimedAt: new Date() },
        })
      }
    }
  }
  const remaining = await prisma.hiringUploadSession.count({ where })
  return { scanned, deleted, failed, remaining, truncated: remaining > 0 }
})
