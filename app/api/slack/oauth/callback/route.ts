/**
 * GET /api/slack/oauth/callback
 * Slack authorize 후 리다이렉트되는 콜백. code를 bot 토큰으로 교환하고
 * SlackInstallation을 upsert한다. 결과는 /settings/integrations?slack=<상태>로 리다이렉트.
 *
 * 상태: connected(성공) / denied(사용자 거부) / error(교환 실패·잘못된 state) /
 *       team_conflict(같은 Slack workspace가 이미 다른 Space에 설치됨).
 */
import { NextRequest, NextResponse } from 'next/server'
import { buildAppUrl } from '@/lib/domain'
import { prisma } from '@/lib/prisma'
import { verifyState } from '@/lib/slack/state'
import { oauthV2Access } from '@/lib/slack/client'
import { encryptBotToken } from '@/lib/slack/token-crypto'

export const runtime = 'nodejs'

function redirectTo(status: string): NextResponse {
  return NextResponse.redirect(buildAppUrl(`/settings/integrations?slack=${status}`))
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)

  // 사용자가 Slack 화면에서 취소하면 error 파라미터가 붙는다.
  if (url.searchParams.get('error')) return redirectTo('denied')

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
    return redirectTo('error')
  }

  // 응답 형태: { ok, access_token(xoxb-), bot_user_id, scope, team: { id, name } }
  const botToken = exchange.access_token as string | undefined
  const botUserId = exchange.bot_user_id as string | undefined
  const team = exchange.team as { id?: string; name?: string } | undefined
  if (!botToken || !botUserId || !team?.id) {
    console.error('[slack] oauth 응답에 필수 필드 누락')
    return redirectTo('error')
  }

  try {
    // 암호화도 try 안에서 수행 — ENCRYPTION_KEY 미설정(예: preview) 시 500 대신 error 리다이렉트.
    const enc = encryptBotToken(botToken)
    await prisma.slackInstallation.upsert({
      where: { spaceId: state.spaceId },
      create: {
        spaceId: state.spaceId,
        teamId: team.id,
        teamName: team.name ?? null,
        botUserId,
        botToken: enc.token,
        botTokenIv: enc.iv,
        scope: (exchange.scope as string | undefined) ?? null,
        installedBy: state.userId,
      },
      update: {
        teamId: team.id,
        teamName: team.name ?? null,
        botUserId,
        botToken: enc.token,
        botTokenIv: enc.iv,
        scope: (exchange.scope as string | undefined) ?? null,
        installedBy: state.userId,
      },
    })
  } catch (err) {
    // teamId @unique 충돌 — 같은 Slack workspace가 이미 다른 Space에 설치됨.
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
      return redirectTo('team_conflict')
    }
    console.error('[slack] SlackInstallation upsert 실패:', err)
    return redirectTo('error')
  }

  return redirectTo('connected')
}
