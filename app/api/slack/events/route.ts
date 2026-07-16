/**
 * POST /api/slack/events
 * Slack Events API 엔드포인트.
 *  - url_verification 핸드셰이크
 *  - app_mention 이벤트 → 하이브리드 워크덱 에이전트 라우팅 후 스레드 답글
 *
 * 규약(중요):
 *  - Slack 3초 데드라인: after()로 본 처리를 응답 후로 미루고 즉시 200 반환.
 *  - x-slack-retry-num 헤더가 있으면 즉시 200(중복 처리 방지 — after 완료 전 재시도 도착 가능).
 *  - 웹훅은 항상 200을 반환한다(서명 실패만 401). 에러는 전부 삼켜 로깅만.
 */
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifySlackSignature } from '@/lib/slack/verify'
import { decryptBotToken } from '@/lib/slack/token-crypto'
import { postMessage } from '@/lib/slack/client'
import { routeAgentMessage } from '@/lib/agent/router'
import { resolveActingUserId } from '@/lib/agent/slack/acting-user'

export const runtime = 'nodejs'

// Slack app_mention 이벤트 형태(필요한 필드만).
interface SlackEventCallback {
  type?: string
  team_id?: string
  event?: {
    type?: string
    bot_id?: string
    user?: string
    text?: string
    channel?: string
    ts?: string
    thread_ts?: string
  }
}

export async function POST(req: NextRequest) {
  // 서명은 raw body 바이트 위에서 검증해야 하므로 먼저 text로 읽는다.
  const rawBody = await req.text()
  const ok = verifySlackSignature({
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    timestamp: req.headers.get('x-slack-request-timestamp'),
    rawBody,
    signature: req.headers.get('x-slack-signature'),
  })
  if (!ok) return NextResponse.json({ message: '서명 검증 실패' }, { status: 401 })

  let payload: SlackEventCallback & { challenge?: string }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ message: '잘못된 요청 본문' }, { status: 400 })
  }

  // Events API 등록 시 1회 핸드셰이크.
  if (payload.type === 'url_verification') {
    return NextResponse.json({ challenge: payload.challenge })
  }

  // Slack 재시도(중복) — after 처리 완료 전에 도착할 수 있으므로 즉시 무시.
  if (req.headers.get('x-slack-retry-num')) {
    return NextResponse.json({ ok: true })
  }

  // app_mention 처리 — 응답 후(after)로 미뤄 3초 ack를 지킨다.
  if (payload.type === 'event_callback' && payload.event?.type === 'app_mention') {
    const event = payload.event
    const teamId = payload.team_id
    // 봇 자신의 메시지면 무시(루프 방지).
    if (!event.bot_id && teamId) {
      after(() => handleAppMention(teamId, event))
    }
  }

  return NextResponse.json({ ok: true })
}

/**
 * app_mention 본 처리(응답 후 실행). 모든 에러를 삼켜 로깅만 한다.
 */
async function handleAppMention(
  teamId: string,
  event: NonNullable<SlackEventCallback['event']>
): Promise<void> {
  try {
    // team → SlackInstallation → spaceId. 미설치면 무시.
    const installation = await prisma.slackInstallation.findUnique({
      where: { teamId },
      select: { spaceId: true, botToken: true, botTokenIv: true, botUserId: true },
    })
    if (!installation) return

    const channel = event.channel
    if (!channel) return
    const threadTs = event.thread_ts ?? event.ts
    if (!threadTs) return

    // tool 실행 행위 사용자(Space OWNER의 User.id) 해석. 없으면 처리 불가.
    const actingUserId = await resolveActingUserId(installation.spaceId)
    if (!actingUserId) return

    // 멘션 텍스트에서 <@봇ID> 제거.
    const cleanText = stripMention(event.text ?? '', installation.botUserId)

    const { text } = await routeAgentMessage({
      spaceId: installation.spaceId,
      requestedBy: actingUserId,
      channelId: channel,
      threadTs,
      text: cleanText,
    })

    const token = decryptBotToken(installation.botToken, installation.botTokenIv)
    await postMessage(token, { channel, text, thread_ts: threadTs })
  } catch (err) {
    console.error('[slack] app_mention 처리 에러:', err)
  }
}

// "<@U123> 안녕" → "안녕". 특정 봇 멘션과 임의 멘션 토큰을 모두 제거한다.
function stripMention(text: string, botUserId: string): string {
  return text
    .replace(new RegExp(`<@${botUserId}>`, 'g'), '')
    .replace(/<@[A-Z0-9]+>/g, '')
    .trim()
}
