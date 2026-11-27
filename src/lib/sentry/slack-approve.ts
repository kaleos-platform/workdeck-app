import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/admin/auth'
import { addComment, isSentryApiConfigured, listComments } from '@/lib/sentry/api'
import { analyzeRequestNote, isNoteSigConfigured, noteSig } from '@/lib/sentry/autofix-sig'
import { canApprove, parseAutofixState, shouldWriteNote } from '@/lib/sentry/autofix-status'
import { resolveSlackMember } from '@/lib/slack/member-link'
import { NOTIFICATION_CHANNEL_KIND } from '@/lib/slack/notification-target'
import { OPS_SPACE_ID } from '@/lib/slack/send-notification'
import { findTeamInstallationForSpace } from '@/lib/slack/tenant'
import { decryptBotToken } from '@/lib/slack/token-crypto'

const VALUE = /^(\d+)\|(\d{8}-\d{6}-[0-9a-f]{4}-[A-Za-z0-9-]{3,40})\|([0-9a-f]{16})$/

type SlackInput = { teamId?: string; channelId?: string; slackUserId?: string }

// 공통 가드: OPS 설치 → OPS 알림 채널 → 연결된 구성원 → OPERATOR → Sentry·서명 키. 통과하면 { userId }, 아니면 안내문(또는 조용히 무시 null)
async function authorize(
  input: SlackInput,
  verb: string
): Promise<{ userId: string } | string | null> {
  const { teamId, channelId, slackUserId } = input
  if (!teamId || !channelId || !slackUserId) return null
  const installation = await findTeamInstallationForSpace(OPS_SPACE_ID, teamId)
  if (!installation) return null

  const channel = await prisma.spaceSlackChannel.findFirst({
    where: { spaceId: OPS_SPACE_ID, kind: NOTIFICATION_CHANNEL_KIND, channelId },
    select: { channelId: true },
  })
  if (!channel) return null

  const member = await resolveSlackMember({
    spaceId: OPS_SPACE_ID,
    teamId,
    slackUserId,
    getBotToken: () => decryptBotToken(installation.botToken, installation.botTokenIv),
  })
  if (!member) {
    return `워크덱 구성원과 Slack 연결이 없어 ${verb}할 수 없습니다. 관리자에게 Slack 연결을 요청하세요.`
  }

  const user = await prisma.user.findUnique({
    where: { id: member.userId },
    select: { platformRole: true },
  })
  if (user?.platformRole !== 'OPERATOR') return `운영자만 ${verb}할 수 있습니다.`

  if (!isSentryApiConfigured()) return `Sentry 연결이 설정되지 않아 ${verb}할 수 없습니다.`
  if (!isNoteSigConfigured()) return '승인 서명 키가 설정되지 않았습니다'
  return { userId: member.userId }
}

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

  const g = await authorize(input, '승인')
  if (typeof g !== 'object' || g === null) return g
  const { userId } = g

  try {
    if (!canApprove(parseAutofixState(await listComments(issueId)), id, sha)) {
      return '수정안이 바뀌었거나 이미 처리됐습니다. 어드민에서 확인하세요.'
    }
  } catch {
    return 'Sentry 노트를 읽지 못했습니다. 잠시 후 다시 시도하세요.'
  }

  const meta = { action: 'approve', id, via: 'slack' }
  try {
    await writeAuditLog(userId, 'sentryIssue.autofix', 'sentryIssue', issueId, {
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
    await writeAuditLog(userId, 'sentryIssue.autofix', 'sentryIssue', issueId, {
      ...meta,
      status: 'failed',
    })
    return '승인 기록을 Sentry 에 쓰지 못했습니다. 잠시 후 다시 시도하세요.'
  }
  return '승인했습니다. 10분 안에 PR이 만들어집니다.'
}

/** Slack「분석 요청」버튼 처리. 가드는 승인과 같고, 이미 요청됨·분석 중이면 안내만 한다. */
export async function handleSentryAnalyzeRequest(input: {
  value: string
  teamId?: string
  channelId?: string
  slackUserId?: string
}): Promise<string | null> {
  if (!/^\d+$/.test(input.value)) return null
  const issueId = input.value

  const g = await authorize(input, '요청')
  if (typeof g !== 'object' || g === null) return g
  const { userId } = g

  try {
    if (!shouldWriteNote(parseAutofixState(await listComments(issueId)), 'analyze-request')) {
      return '이미 분석 요청됨'
    }
  } catch {
    return 'Sentry 노트를 읽지 못했습니다. 잠시 후 다시 시도하세요.'
  }

  const meta = { action: 'analyze', via: 'slack' }
  try {
    await writeAuditLog(userId, 'sentryIssue.autofix', 'sentryIssue', issueId, {
      ...meta,
      status: 'requested',
    })
  } catch {
    return '요청을 기록하지 못했습니다. 잠시 후 다시 시도하세요.'
  }
  try {
    await addComment(issueId, analyzeRequestNote(issueId, 'slack'))
  } catch {
    await writeAuditLog(userId, 'sentryIssue.autofix', 'sentryIssue', issueId, {
      ...meta,
      status: 'failed',
    })
    return '분석 요청을 Sentry 에 쓰지 못했습니다. 잠시 후 다시 시도하세요.'
  }
  return '분석을 요청했습니다. 10분~40분 안에 결과가 Slack 으로 옵니다.'
}
