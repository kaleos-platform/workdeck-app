import { NextRequest, NextResponse } from 'next/server'
import { expirePendingActions } from '@/lib/agent/actions/execute'

export const runtime = 'nodejs'

/**
 * GET /api/cron/agent-actions-expire — Vercel cron 호출 전용.
 *
 * 만료(expiresAt 경과)된 PENDING 승인 액션을 EXPIRED로 전환한다.
 * 목록 조회 시 lazy expire의 보완 — 아무도 큐를 열지 않아도 만료가 진행되도록 매일 돌린다.
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

  const expired = await expirePendingActions()
  return NextResponse.json({ ranAt: new Date().toISOString(), expired })
}
