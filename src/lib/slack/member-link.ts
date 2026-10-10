/**
 * Slack 연결 — Slack 사용자 ↔ Space 구성원.
 *  1) SpaceMember.slackUserId 로 조회
 *  2) 없으면 users.info 이메일로 "같은 Space 의 아직 연결 안 된 구성원"을 찾아 자동 연결
 *     (설치된 workspace 소속·이메일 확인된 사람 계정만, interactive 3초 데드라인 안에서 1.5초 제한)
 *     OWNER 는 자동 연결하지 않는다 — OWNER 연결은 본인이 웹에서만 바꾼다(slack-link 라우트).
 * 연결되지 않은 Slack 사용자는 요청은 할 수 있어도 승인은 할 수 없다(CONTEXT.md "Slack 연결").
 * 자동 연결에는 bot scope users:read, users:read.email 이 필요하다 — 없으면 missing_scope → null(수동 연결로).
 */
import { prisma } from '@/lib/prisma'
import type { Role } from '@/lib/auth/roles'
import { slackGet } from './client'

const AUTO_LINK_TIMEOUT_MS = 1500

type SlackUser = {
  deleted?: boolean
  is_bot?: boolean
  is_email_confirmed?: boolean
  team_id?: string
  profile?: { email?: string }
}

async function fetchConfirmedEmail(
  getBotToken: () => string,
  slackUserId: string,
  teamId: string
): Promise<string | null> {
  try {
    // 토큰 복호화 실패도 여기서 흡수한다 — Slack 에 500 을 돌려주지 않고 "연결 없음"으로 처리.
    const res = await slackGet(
      getBotToken(),
      'users.info',
      { user: slackUserId },
      AUTO_LINK_TIMEOUT_MS
    )
    const user = res.ok ? (res.user as SlackUser | undefined) : undefined
    if (!user || user.deleted || user.is_bot || user.is_email_confirmed !== true) return null
    // Slack Connect 외부 사용자는 다른 workspace 의 이메일을 가진다 — 설치 workspace 소속만 연결.
    if (user.team_id !== teamId) return null
    return user.profile?.email?.trim() || null
  } catch {
    return null
  }
}

export async function resolveSlackMember(input: {
  spaceId: string
  teamId: string
  slackUserId: string
  getBotToken: () => string
}): Promise<{ userId: string; role: Role } | null> {
  const findLinked = async () => {
    const linked = await prisma.spaceMember.findUnique({
      where: { spaceId_slackUserId: { spaceId: input.spaceId, slackUserId: input.slackUserId } },
      select: { userId: true, role: true },
    })
    return linked ? { userId: linked.userId, role: linked.role as Role } : null
  }
  const linked = await findLinked()
  if (linked) return linked

  const email = await fetchConfirmedEmail(input.getBotToken, input.slackUserId, input.teamId)
  if (!email) return null

  const member = await prisma.spaceMember.findFirst({
    where: {
      spaceId: input.spaceId,
      slackUserId: null,
      role: { not: 'OWNER' },
      user: { email: { equals: email, mode: 'insensitive' } },
    },
    select: { id: true, userId: true, role: true },
  })
  if (!member) return null

  // 조건부 갱신 — 조회 뒤 다른 요청(동시 자동 연결·수동 연결)이 먼저 연결했으면 덮어쓰지 않는다.
  try {
    const { count } = await prisma.spaceMember.updateMany({
      where: { id: member.id, spaceId: input.spaceId, slackUserId: null },
      data: { slackUserId: input.slackUserId },
    })
    if (count === 1) return { userId: member.userId, role: member.role as Role }
  } catch (e) {
    // P2002: 이 Slack ID 가 그 사이 다른 구성원에 연결됨 — 아래에서 다시 읽는다.
    if ((e as { code?: string }).code !== 'P2002') throw e
  }
  return findLinked()
}
