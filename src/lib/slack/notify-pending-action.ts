/**
 * 승인 대기 액션이 생성되면 해당 Space의 Slack 승인 채널로 Block Kit 알림을 보낸다.
 *
 * 규약(중요):
 *  - 모든 실패는 try/catch로 삼켜 console.error만 남긴다. 알림 실패가 절대 액션 생성을
 *    막지 않는다(createPendingAction이 이 함수를 await하므로 client.ts의 타임아웃과 함께
 *    동작해 무한 대기도 방지된다).
 *  - registry/create/execute를 import하지 않는다(순환 import 방지). 필요한 값은 전부
 *    AgentPendingAction 행에 있다.
 */
import { prisma } from '@/lib/prisma'
import { buildAppUrl } from '@/lib/domain'
import { decryptBotToken } from './token-crypto'
import { postMessage } from './client'

// 승인 UI에서도 쓰는 deck 라벨(한국어).
const DECK_LABELS: Record<string, string> = {
  finance: '자산·부채 관리',
  'seller-ops': '브랜드 운영',
  'seller-hub': '브랜드 운영',
  'coupang-ads': '쿠팡 광고 관리자',
}

function deckLabel(deckKey: string): string {
  return DECK_LABELS[deckKey] ?? deckKey
}

function formatKst(date: Date): string {
  return date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export async function notifyPendingAction(actionId: string): Promise<void> {
  try {
    const action = await prisma.agentPendingAction.findUnique({
      where: { id: actionId },
      select: {
        id: true,
        spaceId: true,
        deckKey: true,
        actionType: true,
        summary: true,
        requestedBy: true,
        expiresAt: true,
      },
    })
    if (!action) return

    // 설치 + 승인 채널이 있어야 알림을 보낸다(없으면 조용히 반환).
    const installation = await prisma.slackInstallation.findUnique({
      where: { spaceId: action.spaceId },
      select: { botToken: true, botTokenIv: true },
    })
    if (!installation) return

    const channel = await prisma.spaceSlackChannel.findUnique({
      where: { spaceId_kind: { spaceId: action.spaceId, kind: 'approvals' } },
      select: { channelId: true },
    })
    if (!channel) return

    const token = decryptBotToken(installation.botToken, installation.botTokenIv)

    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: '🔔 에이전트 승인 요청', emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: action.summary } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Deck*\n${deckLabel(action.deckKey)}` },
          { type: 'mrkdwn', text: `*액션*\n${action.actionType}` },
          { type: 'mrkdwn', text: `*요청자*\n${action.requestedBy}` },
          { type: 'mrkdwn', text: `*만료*\n${formatKst(action.expiresAt)}` },
        ],
      },
      {
        type: 'actions',
        block_id: `agent_action_${action.id}`,
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '승인', emoji: true },
            style: 'primary',
            action_id: 'agent_action_approve',
            value: action.id,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '거부', emoji: true },
            style: 'danger',
            action_id: 'agent_action_reject',
            value: action.id,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '웹에서 보기', emoji: true },
            action_id: 'agent_action_open_web',
            url: buildAppUrl(`/approvals?action=${action.id}`),
          },
        ],
      },
    ]

    const res = await postMessage(token, {
      channel: channel.channelId,
      text: `에이전트 승인 요청: ${action.summary}`,
      blocks,
    })

    if (res.ok && typeof res.ts === 'string' && typeof res.channel === 'string') {
      // 발송 성공 시 메시지 좌표를 저장 → 웹/Slack 결정 시 chat.update 동기화에 사용.
      await prisma.agentPendingAction.update({
        where: { id: action.id },
        data: { slackChannelId: res.channel, slackMessageTs: res.ts },
      })
    } else if (!res.ok) {
      console.error(`[slack] 승인 알림 전송 실패: ${res.error}`)
    }
  } catch (err) {
    console.error('[slack] notifyPendingAction 에러:', err)
  }
}
