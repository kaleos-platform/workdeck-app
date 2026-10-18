/**
 * /api/slack/notification-target — 워커(coupang-ads/seller-ops)가 workspaceId로
 * 알림을 보낼 Slack 채널 + 암호화된 bot 토큰을 조회한다. x-worker-api-key 인증.
 * target이 null이면 kind="notifications" 채널 미등록 — 호출자는 레거시 경로로 폴백한다.
 * botToken은 암호문 그대로 반환('slack-token' 용도 v1/v0 — 호출자가 field-crypto 로 복호화, getCredentials와 동일 신뢰 모델).
 */
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api-helpers'
import { assertWorkerOwns, authenticateWorker } from '@/lib/worker-auth'
import {
  resolveSlackNotificationTarget,
  resolveDeckNotifyEnabled,
  resolveNotificationSpaceId,
} from '@/lib/slack/notification-target'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await authenticateWorker(req.headers)
  if ('error' in auth) return auth.error

  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) return errorResponse('workspaceId는 필수입니다', 400)
  const denied = assertWorkerOwns(auth.scope, { workspaceId })
  if (denied) return denied
  // Space 토큰이면 알림 Space(Workspace.spaceId 우선)도 토큰 Space와 같아야 한다 — 레거시 키로
  // 워크스페이스와 Space 축이 어긋난 데이터에서 다른 Space의 채널·bot 토큰을 받지 못하게.
  if (auth.scope.kind === 'space') {
    const notifySpaceId = await resolveNotificationSpaceId(workspaceId)
    if (notifySpaceId && notifySpaceId !== auth.scope.spaceId)
      return errorResponse('다른 공간의 자원에 접근할 수 없습니다', 403)
  }

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
