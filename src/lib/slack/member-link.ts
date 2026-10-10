/**
 * Slack 연결 — Slack 사용자 ↔ Space 구성원.
 *  1) SpaceMember.slackUserId 로 조회
 *  2) 없으면 users.info 이메일로 "같은 Space 의 아직 연결 안 된 구성원"을 찾아 자동 연결
 *     (이메일 확인된 사람 계정만, interactive 3초 데드라인 안에서 1.5초 제한)
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
  profile?: { email?: string }
}

async function fetchConfirmedEmail(
  getBotToken: () => string,
  slackUserId: string
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
    return user.profile?.email?.trim() || null
  } catch {
    return null
  }
}

export async function resolveSlackMember(input: {
  spaceId: string
  slackUserId: string
  getBotToken: () => string
}): Promise<{ userId: string; role: Role } | null> {
  const linked = await prisma.spaceMember.findUnique({
    where: { spaceId_slackUserId: { spaceId: input.spaceId, slackUserId: input.slackUserId } },
    select: { userId: true, role: true },
  })
  if (linked) return { userId: linked.userId, role: linked.role as Role }

  const email = await fetchConfirmedEmail(input.getBotToken, input.slackUserId)
  if (!email) return null

  const member = await prisma.spaceMember.findFirst({
    where: {
      spaceId: input.spaceId,
      slackUserId: null,
      user: { email: { equals: email, mode: 'insensitive' } },
    },
    select: { id: true, userId: true, role: true },
  })
  if (!member) return null

  try {
    await prisma.spaceMember.update({
      where: { id: member.id },
      data: { slackUserId: input.slackUserId },
    })
  } catch {
    return null // 동시 연결 경합(P2002) — 다음 클릭에서 1) 로 다시 조회된다
  }
  return { userId: member.userId, role: member.role as Role }
}
