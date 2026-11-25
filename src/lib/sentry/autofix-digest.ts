import type { ErrorRow } from '@/components/admin/errors-table'
import { isSentryApiConfigured } from '@/lib/sentry/api'
import { buildErrorRows } from '@/lib/sentry/error-rows'
import { escapeMrkdwn } from '@/lib/slack/mrkdwn'
import { OPS_SPACE_ID, sendSystemNotification } from '@/lib/slack/send-notification'
import { isApprovable, triageReason } from './autofix-status'

const ADMIN_URL = 'https://admin.workdeck.work/admin/errors?stage=approval'
const MAX_ITEMS = 5
const MAX_TITLE = 80

// Sentry 유래 문자열은 자르고 나서 이스케이프한다. `://` 는 U+2044 로 바꿔 자동 링크를 막는다
const safe = (s: string, max: number) =>
  escapeMrkdwn(
    (s.length > max ? `${s.slice(0, max)}…` : s).replaceAll('://', ':\u2044\u2044')
  ).replace(/\s+/g, ' ')

const reasonOf = (r: ErrorRow) => (r.triage ? triageReason(r.triage, r) : '판단 없음')

export function buildDigestMessage(rows: ErrorRow[]) {
  const approval = rows.filter((r) => r.stage === 'approval' && isApprovable(r.autofix))
  // 검증 실패·리뷰 차단된 ready 는 버튼 없이 확인 필요로
  const confirm = rows.filter(
    (r) => r.stage === 'confirm' || (r.stage === 'approval' && !isApprovable(r.autofix))
  )
  if (approval.length === 0 && confirm.length === 0) return null

  const n = (p: 'P1' | 'P2' | 'P3') => rows.filter((r) => r.triage?.p === p).length
  const unjudged = rows.filter((r) => !r.triage).length
  const header = `Sentry 오류 판단 — P1 ${n('P1')} · P2 ${n('P2')} · P3 ${n('P3')} · 판단 전 ${unjudged}`

  const blocks: unknown[] = [{ type: 'section', text: { type: 'mrkdwn', text: `*${header}*` } }]
  for (const r of approval.slice(0, MAX_ITEMS)) {
    const a = r.autofix
    const text =
      `*승인 대기* ${safe(r.shortId, 30)} ${safe(r.title, MAX_TITLE)} — ${reasonOf(r)}` +
      ` · 변경 ${a.files ?? 0}개 파일/${a.lines ?? 0}줄` +
      ` · 검증 통과 · 리뷰 ${a.review}`
    blocks.push(
      { type: 'section', text: { type: 'mrkdwn', text } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            style: 'primary',
            text: { type: 'plain_text', text: 'PR 올리기' },
            action_id: 'sentry_autofix_approve',
            value: `${r.id}|${a.id}|${a.sha}`,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '어드민에서 보기' },
            url: ADMIN_URL,
            action_id: 'sentry_autofix_open',
          },
        ],
      }
    )
  }
  const lines = confirm
    .slice(0, MAX_ITEMS)
    .map((r) => `*확인 필요* ${safe(r.shortId, 30)} ${safe(r.title, MAX_TITLE)} — ${reasonOf(r)}`)
  if (lines.length > 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } })
  }
  const count = (s: ErrorRow['stage']) => rows.filter((r) => r.stage === s).length
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `제외 제안 ${count('ignore-suggested')} · 수정 예정 ${count('fix-planned')} · <${ADMIN_URL}|어드민에서 보기>`,
      },
    ],
  })
  return { blocks, text: header }
}

export async function runSentryAutofixDigest(): Promise<Record<string, unknown>> {
  if (!isSentryApiConfigured()) return { skipped: true }
  const { rows } = await buildErrorRows('all', Infinity)
  const message = buildDigestMessage(rows)
  if (!message) return { skipped: true }
  const sent = await sendSystemNotification({ ...message, spaceId: OPS_SPACE_ID })
  return { sent }
}
