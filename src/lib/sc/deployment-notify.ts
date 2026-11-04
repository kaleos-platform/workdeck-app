// 자동 게시(Aside) 진행 알림 — 승인 요청 메시지 스레드에 단다(스레드가 없으면 승인 채널에).
// 실패는 삼킨다: 알림이 게시 흐름을 막지 않는다.

import { prisma } from '@/lib/prisma'
import { buildAppUrl } from '@/lib/domain'
import { decryptBotToken } from '@/lib/slack/token-crypto'
import { postMessage } from '@/lib/slack/client'
import { escapeMrkdwn } from '@/lib/slack/mrkdwn'
import { redactErrorMessage } from '@/lib/sc/notifications'

export type DeploymentNotice =
  | { kind: 'assets-needed'; contentId: string; slots: number }
  | { kind: 'published'; platformUrl: string }
  | { kind: 'draft-saved' }
  | { kind: 'needs-review'; message: string }
  | { kind: 'failed'; message: string }

function noticeText(title: string, contentUrl: string, n: DeploymentNotice): string {
  const t = `「${escapeMrkdwn(title)}」`
  switch (n.kind) {
    case 'assets-needed':
      return `📷 ${t} 승인 완료. 본문의 사진 자리 ${n.slots}곳을 채우면 바로 게시합니다.\n<${contentUrl}|Workdeck에서 사진 등록하기>`
    case 'published':
      return `✅ ${t} 네이버 블로그에 게시했습니다.\n${n.platformUrl}`
    case 'draft-saved':
      return `📝 ${t} 네이버 임시저장까지 마쳤습니다(리허설). 네이버 글쓰기의 임시저장 글에서 확인·발행한 뒤 <${contentUrl}|Workdeck>에 글 주소를 넣어 주세요.`
    case 'needs-review':
      return `⚠️ ${t} 자동 게시를 멈췄습니다: ${escapeMrkdwn(redactErrorMessage(n.message))}\n네이버에서 확인한 뒤 <${contentUrl}|Workdeck>에서 게시 완료 또는 취소해 주세요.`
    case 'failed':
      return `❌ ${t} 자동 게시 실패: ${escapeMrkdwn(redactErrorMessage(n.message))}\n<${contentUrl}|Workdeck에서 보기>`
  }
}

export async function notifyDeploymentThread(
  deploymentId: string,
  notice: DeploymentNotice
): Promise<void> {
  try {
    const d = await prisma.contentDeployment.findUnique({
      where: { id: deploymentId },
      select: {
        spaceId: true,
        contentId: true,
        notifySlackChannelId: true,
        notifySlackThreadTs: true,
        content: { select: { title: true } },
      },
    })
    if (!d) return
    const installation = await prisma.slackInstallation.findUnique({
      where: { spaceId: d.spaceId },
      select: { botToken: true, botTokenIv: true },
    })
    if (!installation) return
    let channel = d.notifySlackChannelId
    if (!channel) {
      const approvals = await prisma.spaceSlackChannel.findFirst({
        where: { spaceId: d.spaceId, kind: 'approvals' },
        orderBy: { createdAt: 'desc' },
        select: { channelId: true },
      })
      channel = approvals?.channelId ?? null
    }
    if (!channel) return

    const contentUrl = buildAppUrl(`/d/sales-content/contents/${d.contentId}`)
    const res = await postMessage(decryptBotToken(installation.botToken, installation.botTokenIv), {
      channel,
      thread_ts: d.notifySlackChannelId ? (d.notifySlackThreadTs ?? undefined) : undefined,
      text: noticeText(d.content.title, contentUrl, notice),
    })
    if (!res.ok) console.error(`[sc-notify] Slack 전송 실패: ${res.error}`)
  } catch (err) {
    console.error('[sc-notify] notifyDeploymentThread 에러:', err)
  }
}
