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
import { isTogglableEvent } from './notification-events'

export const NOTIFICATION_CHANNEL_KIND = 'notifications'

export type SlackNotificationTarget = {
  spaceId: string
  channelId: string
  botToken: string // AES-256-CBC hex 암호문 (평문 아님 — 호출자가 ENCRYPTION_KEY로 복호화)
  botTokenIv: string
}

/**
 * workspaceId로 알림 대상 Space를 해석한다.
 * User 1:Workspace 1:PERSONAL Space 1 모델이라 Workspace.ownerId로 유저의 SpaceMember를
 * 찾고, 같은 유저가 여러 Space 멤버십을 가질 수 있으므로 OWNER 우선, 없으면 최고참(createdAt asc).
 * 알림 채널 조회와 Deck 토글 게이트가 같은 Space를 보도록 공유한다.
 */
export async function resolveNotificationSpaceId(workspaceId: string): Promise<string | null> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true },
  })
  if (!workspace) return null

  const memberships = await prisma.spaceMember.findMany({
    where: { userId: workspace.ownerId },
    orderBy: { createdAt: 'asc' },
    select: { spaceId: true, role: true },
  })
  if (memberships.length === 0) return null
  const membership = memberships.find((m) => m.role === 'OWNER') ?? memberships[0]
  return membership.spaceId
}

/**
 * workspaceId로 알림 발송 대상(Slack 채널 + 암호화된 bot 토큰)을 찾는다.
 * kind="notifications" 채널이 등록되지 않았으면 null — 호출자는 레거시 경로로 폴백한다.
 */
export async function resolveSlackNotificationTarget(
  workspaceId: string
): Promise<SlackNotificationTarget | null> {
  const spaceId = await resolveNotificationSpaceId(workspaceId)
  if (!spaceId) return null

  const channel = await prisma.spaceSlackChannel.findUnique({
    where: { spaceId_kind: { spaceId, kind: NOTIFICATION_CHANNEL_KIND } },
    select: {
      channelId: true,
      installation: { select: { botToken: true, botTokenIv: true } },
    },
  })
  if (!channel) return null

  return {
    spaceId,
    channelId: channel.channelId,
    botToken: channel.installation.botToken,
    botTokenIv: channel.installation.botTokenIv,
  }
}

/**
 * Deck 단위 Slack 알림 토글 상태를 조회한다.
 * - 마스터 slackNotifyEnabled === false 면 발송 차단(false).
 * - eventKey가 주어지고 레지스트리상 togglable이며 slackNotifyEvents[eventKey] === false 면 차단(false).
 * - 비togglable·미기재 이벤트, Space·DeckInstance 미해석은 발송을 막지 않도록 true(fail-open).
 */
export async function resolveDeckNotifyEnabled(
  workspaceId: string,
  deckKey: string,
  eventKey?: string
): Promise<boolean> {
  const spaceId = await resolveNotificationSpaceId(workspaceId)
  if (!spaceId) return true

  const deckInstance = await prisma.deckInstance.findUnique({
    where: { spaceId_deckAppId: { spaceId, deckAppId: deckKey } },
    select: { slackNotifyEnabled: true, slackNotifyEvents: true },
  })
  if (!deckInstance) return true
  if (!deckInstance.slackNotifyEnabled) return false

  // 이벤트 단위 토글 — togglable 이벤트가 명시적으로 false로 기록된 경우에만 차단.
  if (eventKey && isTogglableEvent(deckKey, eventKey)) {
    const events = deckInstance.slackNotifyEvents as Record<string, boolean> | null
    if (events?.[eventKey] === false) return false
  }
  return true
}
