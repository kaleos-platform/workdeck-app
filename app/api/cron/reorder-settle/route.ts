import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { settleEligiblePlans } from '@/lib/inv/forecast/settle-accuracy'

export const runtime = 'nodejs'

/**
 * GET /api/cron/reorder-settle — Vercel cron 호출 전용.
 *
 * 예측 검증(확정) 계획 중 평가창(confirmedAt + 리드타임)이 경과한 옵션을 정산해
 * ReorderPlanAccuracy를 채운다. 발주 계획 생성 시점 lazy 정산의 보완 — 신규 계획이
 * 한동안 생성되지 않아도 신뢰도 측정·bias 학습 루프가 멈추지 않도록 매일 돌린다.
 *
 * Vercel cron 인증: `Authorization: Bearer ${CRON_SECRET}` 헤더 필수.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET 미설정' }, { status: 401 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 정산 대상 계획이 있을 수 있는 space만 추림 (FINALIZED + 미대체 + confirmedAt)
  const spaces = await prisma.reorderPlan.findMany({
    where: { status: 'FINALIZED', supersededAt: null, confirmedAt: { not: null } },
    select: { spaceId: true },
    distinct: ['spaceId'],
  })

  const summary: Array<{ spaceId: string; settled: number; skipped: number }> = []
  for (const { spaceId } of spaces) {
    try {
      const results = await settleEligiblePlans(spaceId)
      summary.push({
        spaceId,
        settled: results.filter((r) => r.ok).length,
        skipped: results.filter((r) => !r.ok).length,
      })
    } catch (err) {
      console.error(`[cron/reorder-settle] space ${spaceId} 정산 실패:`, err)
      summary.push({ spaceId, settled: 0, skipped: 0 })
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), spaces: summary })
}
