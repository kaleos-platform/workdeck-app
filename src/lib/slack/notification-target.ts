/**
 * Workspace → Space → SlackInstallation 알림 채널 해석.
 * 워커(coupang-ads/seller-ops)가 workspaceId 하나로 어느 Slack 채널에 알림을 보낼지
 * 찾을 때 쓴다. User 1:Workspace 1:PERSONAL Space 1 모델이라 Workspace.ownerId로
 * 해당 유저의 SpaceMember를 찾고(여러 개면 OWNER 우선), 그 spaceId로 설치·채널을 조회한다.
 *
 * 이 파일은 App Router 라우트가 아니라 순수 조회 함수다 — 워커 인증 API 라우트가
 * 이 함수를 호출해 감싸는 형태로 노출한다(라우트 자체는 별도 작업으로 추가 예정).
 */
import { prisma } from '@/lib/prisma'

export const NOTIFICATION_CHANNEL_KIND = 'notifications'

export type SlackNotificationTarget = {
  spaceId: string
  channelId: string
  botToken: string // AES-256-CBC hex 암호문 (평문 아님 — 호출자가 ENCRYPTION_KEY로 복호화)
  botTokenIv: string
}

/**
 * workspaceId로 알림 발송 대상(Slack 채널 + 암호화된 bot 토큰)을 찾는다.
 * kind="notifications" 채널이 등록되지 않았으면 null — 호출자는 레거시 경로로 폴백한다.
 */
export async function resolveSlackNotificationTarget(
  workspaceId: string
): Promise<SlackNotificationTarget | null> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true },
  })
  if (!workspace) return null

  // 같은 유저가 여러 Space 멤버십을 가질 수 있으므로 OWNER 우선, 없으면 최고참(createdAt asc).
  const memberships = await prisma.spaceMember.findMany({
    where: { userId: workspace.ownerId },
    orderBy: { createdAt: 'asc' },
    select: { spaceId: true, role: true },
  })
  if (memberships.length === 0) return null
  const membership = memberships.find((m) => m.role === 'OWNER') ?? memberships[0]

  const channel = await prisma.spaceSlackChannel.findUnique({
    where: { spaceId_kind: { spaceId: membership.spaceId, kind: NOTIFICATION_CHANNEL_KIND } },
    select: {
      channelId: true,
      installation: { select: { botToken: true, botTokenIv: true } },
    },
  })
  if (!channel) return null

  return {
    spaceId: membership.spaceId,
    channelId: channel.channelId,
    botToken: channel.installation.botToken,
    botTokenIv: channel.installation.botTokenIv,
  }
}
