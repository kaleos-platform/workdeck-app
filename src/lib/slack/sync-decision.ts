/**
 * 액션이 결정(승인·거부·실패·만료)되면 원본 Slack 메시지를 chat.update로 갱신한다.
 * 버튼을 제거하고 최종 상태 문구·결정자·시각을 표기한다.
 *
 * 규약: slackMessageTs가 없으면 no-op. 모든 실패는 무해(try/catch, console.error).
 *       웹 PATCH·Slack interactive 양쪽에서 호출되므로 registry를 import하지 않는다.
 */
import { prisma } from '@/lib/prisma'
import { decryptBotToken } from './token-crypto'
import { chatUpdate } from './client'

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

// 상태별 최종 문구.
function statusLine(status: string): string {
  switch (status) {
    case 'EXECUTED':
      return '✅ 승인·실행됨'
    case 'REJECTED':
      return '❌ 거부됨'
    case 'FAILED':
      return '⚠️ 실행 실패'
    case 'EXPIRED':
      return '⏰ 만료됨'
    case 'APPROVED':
      return '✅ 승인됨'
    default:
      return status
  }
}

export async function syncSlackDecision(actionId: string): Promise<void> {
  try {
    const action = await prisma.agentPendingAction.findUnique({
      where: { id: actionId },
      select: {
        spaceId: true,
        summary: true,
        status: true,
        decidedBy: true,
        decidedAt: true,
        error: true,
        slackChannelId: true,
        slackMessageTs: true,
      },
    })
    if (!action || !action.slackMessageTs || !action.slackChannelId) return

    const installation = await prisma.slackInstallation.findUnique({
      where: { spaceId: action.spaceId },
      select: { botToken: true, botTokenIv: true },
    })
    if (!installation) return

    const token = decryptBotToken(installation.botToken, installation.botTokenIv)

    const contextParts: string[] = [statusLine(action.status)]
    if (action.decidedBy) contextParts.push(`결정자 ${action.decidedBy}`)
    if (action.decidedAt) contextParts.push(formatKst(action.decidedAt))
    if (action.status === 'FAILED' && action.error) {
      contextParts.push(`오류: ${action.error.slice(0, 200)}`)
    }

    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: '🔔 에이전트 승인 요청', emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: action.summary } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: contextParts.join(' · ') }] },
    ]

    const res = await chatUpdate(token, {
      channel: action.slackChannelId,
      ts: action.slackMessageTs,
      text: `에이전트 승인 요청 — ${statusLine(action.status)}`,
      blocks,
    })
    if (!res.ok) console.error(`[slack] 결정 동기화 실패: ${res.error}`)
  } catch (err) {
    console.error('[slack] syncSlackDecision 에러:', err)
  }
}
