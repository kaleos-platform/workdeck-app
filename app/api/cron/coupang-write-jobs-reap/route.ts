import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'

export const runtime = 'nodejs'

const STALE_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 2
/** 한 번도 집히지 않은 PENDING 가격 잡의 수명. 워커가 죽어 있으면 잡이 쌓여 스페이스 전체 반영을
 * 409 로 막고, 워커가 돌아오면 몇 시간 묵은 가격을 쓴다 — 둘 다 막으려고 만료시킨다. */
const PENDING_PRICE_TTL_MS = 15 * 60 * 1000

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

  // attempts: 0 필수 — 위에서 재큐된 잡은 원래 createdAt 을 그대로 가져 바로 만료돼 버린다.
  const expired = await prisma.coupangWriteJob.updateMany({
    where: {
      kind: 'PRICE_CHANGE',
      status: 'PENDING',
      attempts: 0,
      createdAt: { lt: new Date(Date.now() - PENDING_PRICE_TTL_MS) },
    },
    data: { status: 'FAILED', error: '워커가 처리하지 않아 만료됐습니다', executedAt: new Date() },
  })

  return { failed: failed.count, requeued: requeued.count, expired: expired.count }
})
