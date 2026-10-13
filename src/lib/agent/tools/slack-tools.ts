import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { decryptBotToken } from '@/lib/slack/token-crypto'
import { postMessage } from '@/lib/slack/client'
import { escapeMrkdwn } from '@/lib/slack/mrkdwn'
import { isChannelRegisteredToSpace } from '@/lib/slack/tenant'
import { ToolUserError } from './errors'
import type { McpToolContext, ToolDefinition } from './types'

// <!channel>, <!here|here>, <!EVERYONE> 등 대량 멘션(라벨 변형·대소문자 포함)
const MASS_MENTION_RE = /<!(channel|here|everyone)(\|[^>]*)?>/i

async function actorPrefix(ctx: McpToolContext): Promise<string> {
  if (ctx.actor.type === 'agent' || ctx.actor.type === 'integration') {
    const a = await prisma.spaceAgent.findUnique({
      where: { id: ctx.actor.id },
      select: { name: true },
    })
    // 이름은 사용자가 정한 값이라 멘션·링크로 해석되지 않게 이스케이프한다.
    return a ? `[${escapeMrkdwn(a.name)}] ` : ''
  }
  return ''
}

/**
 * Slack 메시지 전송 — 행위자 Space의 workdeck Slack 설치(bot)로, 그 Space가 등록한 채널에만 보낸다.
 * 업무 데이터를 바꾸지 않는 알림이라 승인 큐를 거치지 않는다(사용자가 승인한 예외). 감사는 runTool.
 * 본문은 에이전트가 의도한 mrkdwn(링크·사용자 멘션)이라 이스케이프하지 않고, 대량 멘션만 막는다.
 */
export const slackPostTool: ToolDefinition = {
  name: 'slack_post',
  description:
    '이 Space에 등록된 Slack 채널(에이전트 채널 등, 또는 그 스레드)에 메시지를 보냅니다. channel은 채널 ID(C…), threadTs를 주면 스레드 답글입니다. 워크덱 설정에서 이 Space에 등록한 채널만 가능하며, @channel/@here/@everyone 전체 멘션은 허용하지 않습니다.',
  inputSchema: {
    channel: z.string().regex(/^[CG][A-Z0-9]{2,20}$/),
    text: z.string().min(1).max(4000),
    threadTs: z
      .string()
      .regex(/^\d+\.\d+$/)
      .optional(),
  },
  mode: 'write',
  scope: 'slack:write',
  async execute(ctx, params) {
    const text = params.text as string
    if (MASS_MENTION_RE.test(text)) {
      throw new ToolUserError('전체 멘션(@channel/@here/@everyone)은 보낼 수 없습니다')
    }

    const channel = params.channel as string
    const installation = await prisma.slackInstallation.findUnique({
      where: { spaceId: ctx.spaceId },
      select: { teamId: true, botToken: true, botTokenIv: true },
    })
    if (!installation) throw new ToolUserError('이 Space에 Slack이 연결되지 않았습니다')
    // 같은 team을 여러 Space가 공유하면 bot도 공유된다. 이 Space가 등록한 채널에만 보낸다(운영 결정).
    if (
      !(await isChannelRegisteredToSpace({
        teamId: installation.teamId,
        channelId: channel,
        spaceId: ctx.spaceId,
      }))
    ) {
      throw new ToolUserError(
        '이 Space에 등록된 채널이 아닙니다. 워크덱 설정에서 이 Space의 에이전트 채널로 등록한 뒤 다시 시도하세요'
      )
    }

    const token = decryptBotToken(installation.botToken, installation.botTokenIv)
    const res = await postMessage(token, {
      channel,
      text: `${await actorPrefix(ctx)}${text}`,
      thread_ts: params.threadTs as string | undefined,
    })
    if (!res.ok) throw new ToolUserError(`Slack 전송 실패: ${res.error ?? 'unknown'}`)
    return { ok: true, channel: res.channel as string, ts: res.ts as string }
  },
}

export const slackTools: ToolDefinition[] = [slackPostTool]
