import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/admin/auth'
import { addComment, isSentryApiConfigured, listComments } from '@/lib/sentry/api'
import { isNoteSigConfigured, noteSig } from '@/lib/sentry/autofix-sig'
import { canApprove, parseAutofixState } from '@/lib/sentry/autofix-status'
import { resolveSlackMember } from '@/lib/slack/member-link'
import { NOTIFICATION_CHANNEL_KIND } from '@/lib/slack/notification-target'
import { OPS_SPACE_ID } from '@/lib/slack/send-notification'
import { findTeamInstallationForSpace } from '@/lib/slack/tenant'
import { decryptBotToken } from '@/lib/slack/token-crypto'

const VALUE = /^(\d+)\|(\d{8}-\d{6}-[0-9a-f]{4}-[A-Za-z0-9-]{3,40})\|([0-9a-f]{16})$/

/**
 * Slack「PR 올리기」버튼 처리. 사용자에게 보일 안내(ephemeral)를 반환하고, 조용히 무시할 때는 null.
 * 가드: OPS team 설치 → OPS 알림 채널 → 연결된 구성원 → platformRole=OPERATOR → 최신 ready 의 id·sha 일치.
 */
export async function handleSentryAutofixApprove(input: {
  value: string
  teamId?: string
  channelId?: string
  slackUserId?: string
}): Promise<string | null> {
  const m = VALUE.exec(input.value)
  if (!m || !input.teamId || !input.channelId || !input.slackUserId) return null
  const [, issueId, id, sha] = m

  const installation = await findTeamInstallationForSpace(OPS_SPACE_ID, input.teamId)
  if (!installation) return null

  const channel = await prisma.spaceSlackChannel.findFirst({
    where: { spaceId: OPS_SPACE_ID, kind: NOTIFICATION_CHANNEL_KIND, channelId: input.channelId },
    select: { channelId: true },
  })
  if (!channel) return null

  const member = await resolveSlackMember({
    spaceId: OPS_SPACE_ID,
    teamId: input.teamId,
    slackUserId: input.slackUserId,
    getBotToken: () => decryptBotToken(installation.botToken, installation.botTokenIv),
  })
  if (!member) {
    return '워크덱 구성원과 Slack 연결이 없어 승인할 수 없습니다. 관리자에게 Slack 연결을 요청하세요.'
  }

  const user = await prisma.user.findUnique({
    where: { id: member.userId },
    select: { platformRole: true },
  })
  if (user?.platformRole !== 'OPERATOR') return '운영자만 승인할 수 있습니다.'

  if (!isSentryApiConfigured()) return 'Sentry 연결이 설정되지 않아 승인할 수 없습니다.'
  if (!isNoteSigConfigured()) return '승인 서명 키가 설정되지 않았습니다'
  try {
    if (!canApprove(parseAutofixState(await listComments(issueId)), id, sha)) {
      return '수정안이 바뀌었거나 이미 처리됐습니다. 어드민에서 확인하세요.'
    }
  } catch {
    return 'Sentry 노트를 읽지 못했습니다. 잠시 후 다시 시도하세요.'
  }

  const meta = { action: 'approve', id, via: 'slack' }
  try {
    await writeAuditLog(member.userId, 'sentryIssue.autofix', 'sentryIssue', issueId, {
      ...meta,
      status: 'requested',
    })
  } catch {
    return '승인을 기록하지 못했습니다. 잠시 후 다시 시도하세요.'
  }
  try {
    await addComment(
      issueId,
      `autofix:approve id=${id} sha=${sha} by=slack sig=${noteSig('approve', issueId, id, sha)}`
    )
  } catch {
    await writeAuditLog(member.userId, 'sentryIssue.autofix', 'sentryIssue', issueId, {
      ...meta,
      status: 'failed',
    })
    return '승인 기록을 Sentry 에 쓰지 못했습니다. 잠시 후 다시 시도하세요.'
  }
  return '승인했습니다. 10분 안에 PR이 만들어집니다.'
}
