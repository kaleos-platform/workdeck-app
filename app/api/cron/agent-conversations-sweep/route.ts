import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

/**
 * GET /api/cron/agent-conversations-sweep — Vercel cron 호출 전용.
 *
 * 7일 이상 갱신되지 않은 대화 세션(AgentConversation)을 삭제한다(TTL).
 * Slack 스레드는 오래되면 사실상 죽으므로 히스토리를 무한 보관하지 않는다.
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

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const { count } = await prisma.agentConversation.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  })

  return NextResponse.json({ ranAt: new Date().toISOString(), deleted: count })
}
