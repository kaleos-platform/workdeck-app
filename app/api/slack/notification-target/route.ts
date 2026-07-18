/**
 * /api/slack/notification-target — 워커(coupang-ads/seller-ops)가 workspaceId로
 * 알림을 보낼 Slack 채널 + 암호화된 bot 토큰을 조회한다. x-worker-api-key 인증.
 * target이 null이면 kind="notifications" 채널 미등록 — 호출자는 레거시 경로로 폴백한다.
 * botToken은 암호문 그대로 반환(호출자가 자신의 ENCRYPTION_KEY로 복호화, getCredentials와 동일 신뢰 모델).
 */
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, resolveWorkerAuth } from '@/lib/api-helpers'
import {
  resolveSlackNotificationTarget,
  resolveDeckNotifyEnabled,
} from '@/lib/slack/notification-target'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = resolveWorkerAuth(req)
  if ('error' in auth) return auth.error

  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) return errorResponse('workspaceId는 필수입니다', 400)

  // deckKey가 주어지면 해당 Deck의 알림 토글 상태를 함께 반환한다(미지정이면 항상 true).
  // eventKey까지 주어지면 이벤트 단위 토글도 반영한다.
  // target은 토글과 무관하게 조회한다 — skip 판단은 호출자(워커)가 notifyEnabled로 한다.
  const deckKey = req.nextUrl.searchParams.get('deckKey')
  const eventKey = req.nextUrl.searchParams.get('eventKey') ?? undefined
  const target = await resolveSlackNotificationTarget(workspaceId)
  const notifyEnabled = deckKey
    ? await resolveDeckNotifyEnabled(workspaceId, deckKey, eventKey)
    : true

  return NextResponse.json({ target, notifyEnabled })
}
