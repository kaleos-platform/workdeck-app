/**
 * 서버측 공용 Slack 발송 헬퍼.
 *  - sendDeckNotification: Deck 단위 알림. DeckInstance.slackNotifyEnabled 토글이 authoritative —
 *    off면 신규·레거시 어느 경로로도 발송하지 않는다. on이면 멀티테넌트(notifications 채널) +
 *    레거시 env(SLACK_BOT_TOKEN/SLACK_CHANNEL_ID) 이중 발송(같은 채널이면 중복 생략).
 *  - sendSystemNotification: Deck 토글과 무관한 운영 알림. 등록된 모든 notifications 채널로 발송.
 *
 * 규약: 모든 실패는 흡수한다(알림 실패가 본 작업 실패로 전파되지 않음 — notify-pending-action.ts와 동일).
 */
import { prisma } from '@/lib/prisma'
import {
  resolveSlackNotificationTarget,
  resolveDeckNotifyEnabled,
  NOTIFICATION_CHANNEL_KIND,
} from './notification-target'
import { decryptBotToken } from './token-crypto'
import { postMessage } from './client'

type NotificationPayload = { blocks: unknown[]; text: string }

// 레거시 env는 호출 시점에 읽는다(테스트 주입 + 런타임 설정 반영).
function legacyEnv(): { token: string; channelId: string } {
  return {
    token: process.env.SLACK_BOT_TOKEN ?? '',
    channelId: process.env.SLACK_CHANNEL_ID ?? '',
  }
}

/** 단일 채널로 Block Kit 메시지를 보낸다. 실패는 로그만 남기고 false 반환. */
async function sendToChannel(
  token: string,
  channelId: string,
  payload: NotificationPayload,
  logTag: string
): Promise<boolean> {
  try {
    const res = await postMessage(token, {
      channel: channelId,
      text: payload.text,
      blocks: payload.blocks,
    })
    if (!res.ok) {
      console.error(`[slack] ${logTag} 전송 실패 (channel=${channelId}): ${res.error}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[slack] ${logTag} 전송 에러 (channel=${channelId}):`, err)
    return false
  }
}

/**
 * Deck 단위 알림 발송. 토글 off면 아무것도 발송하지 않고 false.
 * @returns 하나라도 발송에 성공하면 true.
 */
export async function sendDeckNotification(opts: {
  workspaceId: string
  deckKey: string // 'coupang-ads' | 'seller-hub'
  eventKey?: string // 이벤트 단위 토글 게이트용(레지스트리 키). 미지정이면 마스터 토글만.
  blocks: unknown[]
  text: string
}): Promise<boolean> {
  try {
    // 토글 게이트 — 마스터 off 또는 이벤트 off면 레거시 포함 전부 차단.
    const enabled = await resolveDeckNotifyEnabled(opts.workspaceId, opts.deckKey, opts.eventKey)
    if (!enabled) {
      console.log(`[slack] deck 알림 비활성(${opts.deckKey}) — 발송 생략`)
      return false
    }

    const payload: NotificationPayload = { blocks: opts.blocks, text: opts.text }

    // 신규(멀티테넌트) 경로.
    let newSent = false
    let newChannelId: string | null = null
    const target = await resolveSlackNotificationTarget(opts.workspaceId)
    if (target) {
      newChannelId = target.channelId
      const token = decryptBotToken(target.botToken, target.botTokenIv)
      newSent = await sendToChannel(token, target.channelId, payload, 'deck 알림')
    }

    // 레거시 env 이중 발송 — 단 신규가 이미 같은 채널로 보냈으면 생략.
    const legacy = legacyEnv()
    const legacyConfigured = Boolean(legacy.token && legacy.channelId)
    if (legacyConfigured && !(newSent && newChannelId === legacy.channelId)) {
      const legacySent = await sendToChannel(
        legacy.token,
        legacy.channelId,
        payload,
        '레거시 deck 알림'
      )
      return newSent || legacySent
    }

    return newSent
  } catch (err) {
    console.error('[slack] sendDeckNotification 에러:', err)
    return false
  }
}

/**
 * Deck 토글과 무관한 운영(시스템) 알림. 등록된 모든 notifications 채널로 발송하고,
 * 레거시 env도 이중 발송한다(이미 보낸 채널과 같으면 생략).
 * @returns 하나라도 발송에 성공하면 true.
 */
export async function sendSystemNotification(opts: {
  blocks: unknown[]
  text: string
}): Promise<boolean> {
  try {
    const payload: NotificationPayload = { blocks: opts.blocks, text: opts.text }

    const channels = await prisma.spaceSlackChannel.findMany({
      where: { kind: NOTIFICATION_CHANNEL_KIND },
      select: {
        channelId: true,
        installation: { select: { botToken: true, botTokenIv: true } },
      },
    })

    let anySent = false
    const sentChannelIds = new Set<string>()
    for (const ch of channels) {
      try {
        const token = decryptBotToken(ch.installation.botToken, ch.installation.botTokenIv)
        const sent = await sendToChannel(token, ch.channelId, payload, '시스템 알림')
        if (sent) {
          anySent = true
          sentChannelIds.add(ch.channelId)
        }
      } catch (err) {
        console.error(`[slack] 시스템 알림 채널 처리 실패 (channel=${ch.channelId}):`, err)
      }
    }

    const legacy = legacyEnv()
    const legacyConfigured = Boolean(legacy.token && legacy.channelId)
    if (legacyConfigured && !sentChannelIds.has(legacy.channelId)) {
      const legacySent = await sendToChannel(
        legacy.token,
        legacy.channelId,
        payload,
        '레거시 시스템 알림'
      )
      anySent = anySent || legacySent
    }

    return anySent
  } catch (err) {
    console.error('[slack] sendSystemNotification 에러:', err)
    return false
  }
}
