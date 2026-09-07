/**
 * 서버측 공용 Slack 발송 헬퍼.
 *  - sendDeckNotification: Deck 단위 알림. DeckInstance.slackNotifyEnabled 토글이 authoritative —
 *    off면 발송하지 않는다. on이면 워크스페이스의 notifications 채널로 발송한다.
 *  - sendSystemNotification: Deck 토글과 무관한 운영 알림. 등록된 모든 notifications 채널로 발송.
 *
 * 발송 주체는 워크스페이스 SlackInstallation 봇(workdeck 봇) 하나뿐이다. 전환기에 쓰던
 * 레거시 env(SLACK_BOT_TOKEN/SLACK_CHANNEL_ID, 구 에밀리 봇) 이중 발송은 제거됐다 —
 * 같은 알림이 다른 봇 이름으로 두 번 게시되던 원인.
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
    // 토글 게이트 — 마스터 off 또는 이벤트 off면 발송하지 않는다.
    const enabled = await resolveDeckNotifyEnabled(opts.workspaceId, opts.deckKey, opts.eventKey)
    if (!enabled) {
      console.log(`[slack] deck 알림 비활성(${opts.deckKey}) — 발송 생략`)
      return false
    }

    const payload: NotificationPayload = { blocks: opts.blocks, text: opts.text }

    const target = await resolveSlackNotificationTarget(opts.workspaceId)
    if (!target) {
      console.log(`[slack] notifications 채널 미등록(${opts.deckKey}) — 발송 생략`)
      return false
    }

    const token = decryptBotToken(target.botToken, target.botTokenIv)
    return await sendToChannel(token, target.channelId, payload, 'deck 알림')
  } catch (err) {
    console.error('[slack] sendDeckNotification 에러:', err)
    return false
  }
}

/**
 * Deck 토글과 무관한 운영(시스템) 알림. 등록된 모든 notifications 채널로 발송한다.
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
    for (const ch of channels) {
      try {
        const token = decryptBotToken(ch.installation.botToken, ch.installation.botTokenIv)
        const sent = await sendToChannel(token, ch.channelId, payload, '시스템 알림')
        if (sent) anySent = true
      } catch (err) {
        console.error(`[slack] 시스템 알림 채널 처리 실패 (channel=${ch.channelId}):`, err)
      }
    }

    return anySent
  } catch (err) {
    console.error('[slack] sendSystemNotification 에러:', err)
    return false
  }
}
