/**
 * 한 Slack workspace(team)를 여러 Space가 공유할 때의 Space 결정.
 * - SlackInstallation은 Space당 1행이고 teamId는 비고유다.
 * - 같은 team 안에서 채널 하나는 Space 하나에만 등록된다(채널 API가 409로 막는다).
 * - 채널 → Space가 정해지지 않으면 어느 Space로도 떨어뜨리지 않는다(다른 Space 데이터 노출 방지).
 *   설치가 하나여도 같다 — 2→1 전이(재연결·해제) 뒤 떠난 Space의 채널이 남은 Space로 가지 않게.
 */
import { prisma } from '@/lib/prisma'

export type TeamInstallation = {
  spaceId: string
  botToken: string
  botTokenIv: string
  botUserId: string
}

export type EventRoute =
  | { status: 'routed'; installation: TeamInstallation }
  // 안내 답글용 토큰만 준다. spaceId를 주지 않아 호출자가 데이터를 조회할 수 없다.
  | { status: 'unmapped'; botToken: string; botTokenIv: string }
  | { status: 'not_installed' }

/** app_mention 등 inbound 이벤트의 Space를 정한다. */
export async function resolveEventSpace(teamId: string, channelId: string): Promise<EventRoute> {
  const installs = await prisma.slackInstallation.findMany({
    where: { teamId },
    select: { spaceId: true, botToken: true, botTokenIv: true, botUserId: true },
    orderBy: { createdAt: 'asc' },
  })
  if (installs.length === 0) return { status: 'not_installed' }
  // 설치 개수와 무관하게 등록된 채널에서만 응답한다(운영 결정).

  const mapped = await prisma.spaceSlackChannel.findFirst({
    where: { channelId, spaceId: { in: installs.map((i) => i.spaceId) } },
    select: { spaceId: true },
  })
  const hit = mapped ? installs.find((i) => i.spaceId === mapped.spaceId) : undefined
  if (hit) return { status: 'routed', installation: hit }
  return { status: 'unmapped', botToken: installs[0].botToken, botTokenIv: installs[0].botTokenIv }
}

/** 승인 버튼 테넌트 가드: pending Space의 설치가 버튼을 누른 team인지. */
export async function findTeamInstallationForSpace(
  spaceId: string,
  teamId: string
): Promise<{ teamId: string; botToken: string; botTokenIv: string } | null> {
  const installation = await prisma.slackInstallation.findUnique({
    where: { spaceId },
    select: { teamId: true, botToken: true, botTokenIv: true },
  })
  return installation && installation.teamId === teamId ? installation : null
}

/** 같은 team을 쓰는 다른 Space가 이미 등록한 채널인지(slack_post 거부). 읽기 전용 판정 — 등록은 registerSpaceChannel만. */
export async function findChannelOwnedByOtherSpace(input: {
  teamId: string
  channelId: string
  spaceId: string
}): Promise<boolean> {
  const taken = await prisma.spaceSlackChannel.findFirst({
    where: {
      channelId: input.channelId,
      spaceId: { not: input.spaceId },
      installation: { teamId: input.teamId },
    },
    select: { id: true },
  })
  return taken !== null
}

/**
 * 채널 등록의 유일한 경로. 두 경합을 막는다(채널 → Space 단일 소유 = 테넌트 경계).
 *  - 두 ADMIN이 같은 순간 같은 채널을 등록: (teamId, channelId) lock.
 *  - 등록 중 재연결로 team이 바뀜: OAuth 콜백과 같은 Space 설치 lock을 먼저 잡고, teamId를 트랜잭션 안에서 다시 읽는다.
 *    밖에서 읽은 teamId를 쓰면 이전 team의 lock으로 검사해 새 team의 다른 Space와 직렬화되지 않는다.
 */
export async function registerSpaceChannel(input: {
  spaceId: string
  channelId: string
  channelName: string | null
  kind: string
}): Promise<
  | {
      ok: true
      channel: { id: string; channelId: string; channelName: string | null; kind: string }
    }
  | { ok: false; reason: 'taken' | 'not_installed' }
> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`slack-install:${input.spaceId}`}))`
    const installation = await tx.slackInstallation.findUnique({
      where: { spaceId: input.spaceId },
      select: { teamId: true },
    })
    if (!installation) return { ok: false as const, reason: 'not_installed' as const }
    const teamId = installation.teamId
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`slack-channel:${teamId}:${input.channelId}`}))`
    const taken = await tx.spaceSlackChannel.findFirst({
      where: {
        channelId: input.channelId,
        spaceId: { not: input.spaceId },
        installation: { teamId },
      },
      select: { id: true },
    })
    if (taken) return { ok: false as const, reason: 'taken' as const }
    const channel = await tx.spaceSlackChannel.upsert({
      where: { spaceId_kind: { spaceId: input.spaceId, kind: input.kind } },
      create: {
        spaceId: input.spaceId,
        channelId: input.channelId,
        channelName: input.channelName,
        kind: input.kind,
      },
      update: { channelId: input.channelId, channelName: input.channelName },
      select: { id: true, channelId: true, channelName: true, kind: true },
    })
    return { ok: true as const, channel }
  })
}
