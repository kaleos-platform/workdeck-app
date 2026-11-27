import 'server-only'
import { buildAdminUrl } from '@/lib/domain'
import { FEEDBACK_TYPE_LABEL } from '@/lib/feedback/policy'
import type { UserFeedbackType } from '@/generated/prisma/enums'

const ENV_PREFIX =
  process.env.VERCEL_ENV === 'production'
    ? ''
    : `[${(process.env.VERCEL_ENV ?? 'local').toUpperCase()}] `

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export type FeedbackNotifyInput = {
  id: string
  type: UserFeedbackType
  userEmail: string
  spaceName: string | null
  pagePath: string | null
  body: string
  attachmentCount: number
  capReached: boolean
}

/** 의견 접수 Slack 알림 — 절대 throw 하지 않는다. 원본·서명 URL은 싣지 않는다. */
export async function notifyFeedbackSlack(i: FeedbackNotifyInput): Promise<void> {
  try {
    const url = process.env.FEEDBACK_SLACK_WEBHOOK_URL || process.env.LEAD_SLACK_WEBHOOK_URL
    if (!url) return
    const body = i.body.length > 300 ? `${i.body.slice(0, 300)}…` : i.body
    const text = [
      `${ENV_PREFIX}:speech_balloon: 새 의견 (${FEEDBACK_TYPE_LABEL[i.type]})`,
      `보낸 사람: ${esc(i.userEmail)}${i.spaceName ? ` / ${esc(i.spaceName)}` : ''}`,
      ...(i.pagePath ? [`화면: ${esc(i.pagePath)}`] : []),
      esc(body),
      `첨부: ${i.attachmentCount}장${i.capReached ? ' (첨부 용량 상한 도달 — 이미지 미저장)' : ''}`,
      `관리: ${buildAdminUrl(`/admin/feedback/${i.id}`)}`,
    ].join('\n')
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) console.error('[feedback] slack webhook', res.status)
  } catch (e) {
    console.error('[feedback] slack 알림 실패:', (e as Error)?.message)
  }
}
