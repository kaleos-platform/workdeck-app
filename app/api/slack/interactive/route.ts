/**
 * POST /api/slack/interactive
 * Slack Block Kit 버튼(승인/거부) 콜백. 3초 내 200을 반환해야 한다(전부 DB 작업이라 충분).
 *
 * 보안(핵심): 이 채널은 Space 신뢰 경계다. 반드시 두 가지를 확인한다.
 *   1) payload.team.id로 조회한 SlackInstallation.spaceId === action.spaceId
 *      (cross-team 위조 차단 — 다른 Slack workspace가 남의 액션을 결정할 수 없다).
 *   2) payload.channel.id === action.slackChannelId (원본 알림 채널에서만 결정).
 *   Slack 사용자 → 워크덱 역할 매핑은 M3 범위 밖(채널 접근권=승인권으로 간주).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifySlackSignature } from '@/lib/slack/verify'
import { postResponseUrl } from '@/lib/slack/client'
import { approveAndExecute, rejectAction } from '@/lib/agent/actions/execute'
import { syncSlackDecision } from '@/lib/slack/sync-decision'

export const runtime = 'nodejs'

const APPROVE_ACTION = 'agent_action_approve'
const REJECT_ACTION = 'agent_action_reject'

interface BlockActionsPayload {
  type?: string
  user?: { id?: string }
  team?: { id?: string }
  channel?: { id?: string }
  response_url?: string
  actions?: Array<{ action_id?: string; value?: string }>
}

// response_url로 ephemeral 안내를 보낸다(원본 메시지는 유지). 타임아웃은 client.ts에서 적용.
async function postEphemeral(responseUrl: string, text: string): Promise<void> {
  try {
    await postResponseUrl(responseUrl, {
      text,
      response_type: 'ephemeral',
      replace_original: false,
    })
  } catch (err) {
    console.error('[slack] ephemeral 응답 실패:', err)
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const ok = verifySlackSignature({
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    timestamp: req.headers.get('x-slack-request-timestamp'),
    rawBody,
    signature: req.headers.get('x-slack-signature'),
  })
  if (!ok) return NextResponse.json({ message: '서명 검증 실패' }, { status: 401 })

  // interactive는 application/x-www-form-urlencoded의 payload 필드에 JSON이 담긴다.
  const payloadStr = new URLSearchParams(rawBody).get('payload')
  if (!payloadStr) return NextResponse.json({ ok: true })

  let payload: BlockActionsPayload
  try {
    payload = JSON.parse(payloadStr)
  } catch {
    return NextResponse.json({ ok: true })
  }

  if (payload.type !== 'block_actions') return NextResponse.json({ ok: true })

  const action = payload.actions?.find(
    (a) => a.action_id === APPROVE_ACTION || a.action_id === REJECT_ACTION
  )
  if (!action?.value) return NextResponse.json({ ok: true })

  const actionId = action.value
  const decision = action.action_id === APPROVE_ACTION ? 'approve' : 'reject'

  // 액션 로드 — 없으면 조용히 200.
  const pending = await prisma.agentPendingAction.findUnique({
    where: { id: actionId },
    select: { id: true, spaceId: true, slackChannelId: true },
  })
  if (!pending) return NextResponse.json({ ok: true })

  // 테넌트 가드: 요청한 Slack workspace의 설치가 액션의 Space와 일치해야 한다.
  const teamId = payload.team?.id
  if (!teamId) return NextResponse.json({ ok: true })

  const installation = await prisma.slackInstallation.findUnique({
    where: { teamId },
    select: { spaceId: true },
  })
  if (!installation || installation.spaceId !== pending.spaceId) {
    // cross-team 위조 — 조용히 무시(공격자에게 정보 노출 안 함).
    return NextResponse.json({ ok: true })
  }

  // 원본 알림 채널에서만 결정 허용.
  if (pending.slackChannelId && payload.channel?.id !== pending.slackChannelId) {
    return NextResponse.json({ ok: true })
  }

  const decider = `slack:${payload.user?.id ?? 'unknown'}`
  const outcome =
    decision === 'approve'
      ? await approveAndExecute(actionId, decider)
      : await rejectAction(actionId, decider)

  await syncSlackDecision(actionId)

  // 경합 패자·이미 처리된 요청 → ephemeral 안내(원본 메시지는 sync가 최종 상태 유지).
  if (outcome.status === 'CONFLICT' && payload.response_url) {
    await postEphemeral(payload.response_url, '이미 처리된 요청입니다.')
  }

  return NextResponse.json({ ok: true })
}
