/**
 * 쓰기 권한으로 바로 실행된 액션(EXECUTED·FAILED)을 Space 의 Slack 승인 채널에 알린다 — 승인 알림을 대신하는 사후 확인 수단.
 *
 * 규약:
 *  - deck 별 Slack 알림 토글은 보지 않는다(승인 대체 수단이라 항상 보낸다).
 *  - 전송 실패는 실행 결과에 영향이 없다. 실패 사유는 AgentPendingAction.notifyError 에 남겨 승인 내역에 표시한다.
 *  - registry/create/execute 를 import 하지 않는다(순환 방지) — 결과 링크는 호출자가 넘긴다.
 */
import { prisma } from '@/lib/prisma'
import { buildAppUrl } from '@/lib/domain'
import { decryptBotToken } from './token-crypto'
import { postMessage } from './client'
import { escapeMrkdwn } from './mrkdwn'
import { maskSecrets } from '@/lib/agent/audit'

/** Space 의 Slack 실행·승인 알림 대상(설치 + 승인 알림 채널). 없으면 null — notifyPendingAction 과 같은 해석. */
export async function resolveApprovalsTarget(
  spaceId: string
): Promise<{ botToken: string; botTokenIv: string; channelId: string } | null> {
  const installation = await prisma.slackInstallation.findUnique({
    where: { spaceId },
    select: { botToken: true, botTokenIv: true },
  })
  if (!installation) return null
  const channel = await prisma.spaceSlackChannel.findFirst({
    where: { spaceId, kind: 'approvals' },
    orderBy: { createdAt: 'desc' },
    select: { channelId: true },
  })
  if (!channel) return null
  return { ...installation, channelId: channel.channelId }
}

const UPDATE_DRAFT = 'recruiting.posting.update_draft'

async function recordNotifyError(actionId: string, message: string): Promise<void> {
  try {
    await prisma.agentPendingAction.update({
      where: { id: actionId },
      data: { notifyError: maskSecrets(message).slice(0, 300) },
    })
  } catch (err) {
    console.error('[slack] notifyError 기록 실패:', err)
  }
}

export async function notifyAutoExecuted(
  actionId: string,
  opts: { resultUrl?: string | null } = {}
): Promise<void> {
  try {
    const action = await prisma.agentPendingAction.findUnique({
      where: { id: actionId },
      select: {
        id: true,
        spaceId: true,
        actionType: true,
        summary: true,
        status: true,
        error: true,
        beforeState: true,
        actorType: true,
        actorId: true,
        decidedBy: true,
      },
    })
    if (!action) return

    const target = await resolveApprovalsTarget(action.spaceId)
    if (!target) return recordNotifyError(actionId, 'Slack 승인 알림 채널이 연결되어 있지 않습니다')

    const [agent, grantor] = await Promise.all([
      prisma.spaceAgent.findFirst({
        where: { id: action.actorId, spaceId: action.spaceId },
        select: { name: true },
      }),
      action.decidedBy
        ? prisma.user.findUnique({
            where: { id: action.decidedBy },
            select: { name: true, email: true },
          })
        : null,
    ])
    // 이름은 사용자 입력이라 mrkdwn 제어 문자를 이스케이프한다.
    const grantorName = escapeMrkdwn(grantor?.name ?? grantor?.email ?? '알 수 없음')
    const agentName =
      action.actorType === 'user' ? grantorName : escapeMrkdwn(agent?.name ?? '에이전트')
    const grantorLabel = action.actorType === 'agent' ? '권한 부여' : '실행 구성원'
    const summary = escapeMrkdwn(action.summary)
    const approvalsUrl = buildAppUrl(`/approvals?spaceId=${action.spaceId}&action=${action.id}`)

    const failed = action.status === 'FAILED'
    const parts = [
      failed
        ? `⚠️ *${agentName}* 실행 실패: ${summary}\n${escapeMrkdwn(maskSecrets(action.error ?? '알 수 없는 오류'))}`
        : `🤖 *${agentName}* 실행: ${summary}${opts.resultUrl ? ` → <${opts.resultUrl}|결과 보기>` : ''}`,
      `${grantorLabel}: ${grantorName} · <${approvalsUrl}|승인 내역>`,
    ]
    if (!failed && action.actionType === UPDATE_DRAFT && action.beforeState != null) {
      parts.push(`<${approvalsUrl}|이전 내용 보기>`)
    }
    const text = parts.join('\n')

    const res = await postMessage(decryptBotToken(target.botToken, target.botTokenIv), {
      channel: target.channelId,
      text,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
    })
    if (!res.ok) {
      console.error(`[slack] 실행 알림 전송 실패: ${res.error}`)
      await recordNotifyError(actionId, `Slack 전송 실패: ${res.error ?? 'unknown'}`)
    }
  } catch (err) {
    console.error('[slack] notifyAutoExecuted 에러:', err)
    await recordNotifyError(actionId, err instanceof Error ? err.message : '알림 전송 오류')
  }
}
