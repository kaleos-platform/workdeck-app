import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'
import { resolveSpaceIdForWorkspace } from '@/lib/coupang/workspace-space'

export const runtime = 'nodejs'

/**
 * GET /api/cron/coupang-product-sync — Vercel cron 전용.
 *
 * 매일 상품 API 수집 잡을 만든다. 워커에 스케줄 로직을 두지 않는 이유:
 * "하루 1회"를 DB 가 보장해야 워커 재기동에도 중복이 없고, 정기 크롤링
 * 스케줄러(Playwright·Akamai 쿨다운)와 생명주기를 분리할 수 있다.
 */
export const GET = withCronRun('/api/cron/coupang-product-sync', async () => {
  // 쿠팡 자격이 등록된 워크스페이스만 대상.
  const credentials = await prisma.coupangApiCredential.findMany({
    select: { workspaceId: true },
  })

  let created = 0
  for (const { workspaceId } of credentials) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    })
    if (!workspace) continue

    const spaceId = await resolveSpaceIdForWorkspace(workspaceId)
    if (!spaceId) continue

    // 오늘 이미 만든 잡이 있으면 건너뛴다 — cron 재시도에도 중복이 없다.
    const since = new Date(Date.now() - 20 * 60 * 60 * 1000)
    const existing = await prisma.coupangWriteJob.findFirst({
      where: { workspaceId, kind: 'PRODUCT_SYNC', createdAt: { gt: since } },
      select: { id: true },
    })
    if (existing) continue

    await prisma.coupangWriteJob.create({
      data: { workspaceId, spaceId, kind: 'PRODUCT_SYNC', payload: {} },
    })
    created += 1
  }

  return { created }
})
