import { prisma } from '@/lib/prisma'

const SLACK_USER_RE = /^[UW][A-Z0-9]{2,20}$/

/**
 * 에이전트가 넘긴 Slack 사용자 ID를 같은 Space의 구성원으로 바꾼다.
 * - 요청자는 기록용이며 권한을 주지 않는다(자유 지시문·쓰기는 여전히 승인).
 * - Space 경계 밖 구성원은 찾지 않는다(다른 Space 구성원 ID를 넘겨도 null).
 * - Slack 연결이 없으면 requesterUserId=null, 원문 ID만 남긴다(CONTEXT: 요청자 미확인).
 */
export async function resolveRequester(
  spaceId: string,
  slackUserId: string | null
): Promise<{ requesterUserId: string | null; requesterSlackUserId: string | null }> {
  if (!slackUserId || !SLACK_USER_RE.test(slackUserId)) {
    return { requesterUserId: null, requesterSlackUserId: null }
  }
  const member = await prisma.spaceMember.findFirst({
    where: { spaceId, slackUserId },
    select: { userId: true },
  })
  return { requesterUserId: member?.userId ?? null, requesterSlackUserId: slackUserId }
}
