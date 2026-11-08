import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'
import { runIntakeForSpace, type IntakeReport } from '@/lib/sc/osmu/intake'

export const runtime = 'nodejs'
export const maxDuration = 300

// 함수 한도(300s) 안에서 끝내도록 240s 예산. 남은 일은 다음 실행(10분 뒤)이 이어 받는다.
const BUDGET_MS = 240_000

/**
 * GET /api/cron/sc-osmu-intake — Vercel cron(10분).
 * 노션이 연결된 Space 마다 「콘텐츠 발행」 요청 수신 → 소재·사진 준비 → 노션 상태 되쓰기.
 */
export const GET = withCronRun('/api/cron/sc-osmu-intake', async () => {
  const deadline = Date.now() + BUDGET_MS
  // 세일즈 콘텐츠 카드가 켜진 Space 만, 오래 못 돈 Space 부터(한 Space 가 예산을 독식해도 다음 실행엔 뒤로 감).
  const conns = await prisma.scNotionConnection.findMany({
    where: { space: { deckInstances: { some: { deckAppId: 'sales-content', isActive: true } } } },
    orderBy: { lastPolledAt: { sort: 'asc', nulls: 'first' } },
    select: { spaceId: true },
  })
  const results: Record<string, IntakeReport | { error: string }> = {}
  for (const { spaceId } of conns) {
    if (Date.now() > deadline) break
    try {
      results[spaceId] = await runIntakeForSpace(spaceId, deadline)
    } catch (err) {
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 300)
      results[spaceId] = { error }
      await prisma.scNotionConnection
        .update({ where: { spaceId }, data: { lastError: error, lastPolledAt: new Date() } })
        .catch(() => undefined)
    }
  }
  return { spaces: conns.length, results }
})
