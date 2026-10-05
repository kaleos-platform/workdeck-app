import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'

export const runtime = 'nodejs'

const STALE_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 2

/**
 * RUNNING 10분 초과 잡을 회수한다. 애플리케이션 레벨 재시도를 따로 두지 않는 이유:
 * 400 은 영구 실패, 429 는 client 가 이미 백오프, IP 거부는 전 스코프 문제다.
 * 재시도가 유효한 5xx·네트워크 실패는 워커 크래시와 구분되지 않아 이 회수 하나가 둘 다 덮는다.
 * 가격 PUT 은 자연 멱등이라 재실행이 안전하다.
 */
export const GET = withCronRun('/api/cron/coupang-write-jobs-reap', async () => {
  const threshold = new Date(Date.now() - STALE_MS)

  const failed = await prisma.coupangWriteJob.updateMany({
    where: { status: 'RUNNING', claimedAt: { lt: threshold }, attempts: { gt: MAX_ATTEMPTS } },
    data: { status: 'FAILED', error: '워커가 반복해서 중단됐습니다', executedAt: new Date() },
  })

  const requeued = await prisma.coupangWriteJob.updateMany({
    where: { status: 'RUNNING', claimedAt: { lt: threshold } },
    data: { status: 'PENDING', claimedAt: null },
  })

  return { failed: failed.count, requeued: requeued.count }
})
