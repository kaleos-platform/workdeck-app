/**
 * GET /api/slack/oauth/callback
 * Slack authorize 후 리다이렉트되는 콜백. code를 bot 토큰으로 교환하고
 * SlackInstallation을 upsert한다. 결과는 /settings/integrations?slack=<상태>로 리다이렉트.
 *
 * 상태: connected(성공) / denied(사용자 거부) / error(교환 실패·잘못된 state) /
 *       team_conflict(같은 Slack workspace를 쓰는 기존 Space의 OWNER·ADMIN이 아닌 사람이 연결 시도) /
 *       team_changed(이미 다른 team에 설치된 Space — 재연결(?reconnect=1)로만 바꾼다).
 *
 * 같은 Slack workspace를 여러 Space가 연결할 수 있다. 같은 team의 다른 Space 행도 최신 토큰·scope로 맞춘다.
 * 검증된 state의 spaceId를 모든 리다이렉트에 붙인다(두 Space 사용자가 복귀 후 선택을 잃지 않게).
 */
import { NextRequest, NextResponse } from 'next/server'
import { buildAppUrl } from '@/lib/domain'
import { prisma } from '@/lib/prisma'
import { verifyState } from '@/lib/slack/state'
import { oauthV2Access } from '@/lib/slack/client'
import { encryptBotToken } from '@/lib/slack/token-crypto'

export const runtime = 'nodejs'

function redirectTo(status: string, spaceId?: string): NextResponse {
  const q = new URLSearchParams({ slack: status })
  if (spaceId) q.set('spaceId', spaceId) // 서명 검증된 state 값만 넣는다. 쿼리의 spaceId는 쓰지 않는다
  return NextResponse.redirect(buildAppUrl(`/settings/integrations?${q.toString()}`))
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)

  // 사용자가 Slack 화면에서 취소하면 error 파라미터가 붙는다.
  if (url.searchParams.get('error')) {
    const s = url.searchParams.get('state')
    return redirectTo('denied', s ? verifyState(s)?.spaceId : undefined)
  }

  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  if (!code || !stateParam)
    return NextResponse.json({ message: '잘못된 요청입니다' }, { status: 400 })

  const state = verifyState(stateParam)
  if (!state)
    return NextResponse.json({ message: '유효하지 않은 state입니다', status: 400 }, { status: 400 })

  // install과 반드시 바이트 동일해야 한다(redirect_uri 불일치 = Slack 교환 실패).
  const redirectUri = buildAppUrl('/api/slack/oauth/callback')
  const exchange = await oauthV2Access(code, redirectUri)
  if (!exchange.ok) {
    console.error('[slack] oauth.v2.access 실패:', exchange.error)
    return redirectTo('error', state.spaceId)
  }

  // 응답 형태: { ok, access_token(xoxb-), bot_user_id, scope, team: { id, name } }
  const botToken = exchange.access_token as string | undefined
  const botUserId = exchange.bot_user_id as string | undefined
  const team = exchange.team as { id?: string; name?: string } | undefined
  if (!botToken || !botUserId || !team?.id) {
    console.error('[slack] oauth 응답에 필수 필드 누락')
    return redirectTo('error', state.spaceId)
  }

  // 이미 설치된 Space가 다른 team으로 OAuth를 마쳤으면 재연결 흐름으로만 바꾼다.
  // 그냥 덮어쓰면 이전 team의 채널 등록·진행 중 Slack 승인·대화 기록이 새 team에 섞인다.
  const existing = await prisma.slackInstallation.findUnique({
    where: { spaceId: state.spaceId },
    select: { teamId: true },
  })
  const teamChanged = existing !== null && existing.teamId !== team.id
  if (teamChanged && !state.reconnect) return redirectTo('team_changed', state.spaceId)

  // 이미 다른 Space가 쓰는 Slack team에 붙으려면 그 Space 중 하나의 OWNER·ADMIN이어야 한다
  // (teamId @unique가 하던 테넌트 경계를 대신한다).
  const siblings = await prisma.slackInstallation.findMany({
    where: { teamId: team.id, spaceId: { not: state.spaceId } },
    select: { spaceId: true },
  })
  if (siblings.length > 0) {
    const adminOfSibling = await prisma.spaceMember.findFirst({
      where: {
        userId: state.userId,
        spaceId: { in: siblings.map((s) => s.spaceId) },
        role: { in: ['OWNER', 'ADMIN'] },
      },
      select: { id: true },
    })
    if (!adminOfSibling) return redirectTo('team_conflict', state.spaceId)
  }

  try {
    // 암호화도 try 안에서 수행 — 키 미설정(예: preview) 시 500 대신 error 리다이렉트.
    const enc = encryptBotToken(botToken)
    const shared = {
      teamName: team.name ?? null,
      botUserId,
      botToken: enc.token,
      botTokenIv: enc.iv,
      scope: (exchange.scope as string | undefined) ?? null,
    }
    await prisma.$transaction([
      // 채널 등록(registerSpaceChannel)과 같은 Space 설치 lock. 배열 트랜잭션은 한 tx 안에서 순서대로 실행된다.
      // 등록이 먼저 끝나면 아래 deleteMany가 그 채널을 지우고, 재연결이 먼저면 등록이 새 teamId로 다시 검사한다.
      prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`slack-install:${state.spaceId}`}))`,
      // 재연결(team 변경): 이전 team에 묶인 이 Space의 상태를 먼저 정리한다.
      ...(teamChanged
        ? [
            prisma.spaceSlackChannel.deleteMany({ where: { spaceId: state.spaceId } }),
            // 구성원 Slack 연결도 이전 team의 사용자 ID다. 남기면 새 team에서 자동 연결(slackUserId null만 찾음)이 막힌다.
            prisma.spaceMember.updateMany({
              where: { spaceId: state.spaceId, slackUserId: { not: null } },
              data: { slackUserId: null },
            }),
            // 진행 중 승인은 남기되 이전 team 메시지와의 연결을 끊는다(웹에서 승인, 이전 버튼은 테넌트 가드가 무시).
            prisma.agentPendingAction.updateMany({
              where: { spaceId: state.spaceId, status: 'PENDING', slackChannelId: { not: null } },
              data: { slackChannelId: null, slackMessageTs: null },
            }),
            prisma.agentConversation.deleteMany({ where: { spaceId: state.spaceId } }),
          ]
        : []),
      prisma.slackInstallation.upsert({
        where: { spaceId: state.spaceId },
        create: { spaceId: state.spaceId, teamId: team.id, installedBy: state.userId, ...shared },
        update: { teamId: team.id, installedBy: state.userId, ...shared },
      }),
      // 같은 team을 쓰는 다른 Space 행도 같은 bot 토큰·scope로 맞춘다(재설치로 scope가 늘어난 경우).
      prisma.slackInstallation.updateMany({
        where: { teamId: team.id, spaceId: { not: state.spaceId } },
        data: shared,
      }),
    ])
  } catch (err) {
    console.error('[slack] SlackInstallation upsert 실패:', err)
    return redirectTo('error', state.spaceId)
  }

  return redirectTo('connected', state.spaceId)
}
