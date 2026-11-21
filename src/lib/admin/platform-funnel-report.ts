/** 운영사 GA4 주간 퍼널 리포트 — 요약 문구 생성과 Slack 운영 채널 발송. */
import 'server-only'
import { readPlatformGoogle } from '@/lib/admin/platform-google'
import {
  ENHANCED_KEYS,
  FUNNEL_EVENTS,
  loadGa4Bundle,
  type Ga4Bundle,
} from '@/lib/admin/platform-ga4'
import { sendSystemNotification } from '@/lib/slack/send-notification'

export function buildReportText(b: Ga4Bundle): string {
  const lines: string[] = ['*워크덱 홈페이지 GA4 — 최근 7일 퍼널*']
  if (b.measurementId) lines.push(`측정 ID: ${b.measurementId}`)
  if (b.funnel) {
    lines.push(
      FUNNEL_EVENTS.map((e) => `${e} ${b.funnel!.events[e].toLocaleString('ko-KR')}`).join(' · ')
    )
    for (const s of b.funnel.sources.slice(0, 5)) {
      lines.push(`• ${s.source} / ${s.medium}: 가입 ${s.signUp} · 구독 ${s.subscribe}`)
    }
  }
  const on = b.enhanced ? ENHANCED_KEYS.filter((k) => b.enhanced![k] === true) : []
  if (on.length > 0) {
    lines.push(
      `:warning: 향상된 측정이 켜져 있습니다(퍼널 운영 게이트: 모두 꺼져야 함): ${on.join(', ')}`
    )
  }
  for (const e of b.errors) lines.push(`:warning: ${e}`)
  return lines.join('\n')
}

export async function runPlatformFunnelReport(): Promise<{ state: string; sent: boolean }> {
  const row = await readPlatformGoogle()
  let text: string
  let state: string
  if (!row || row.config.status !== 'connected') {
    state = 'not_connected'
    text =
      ':warning: 워크덱 홈페이지 GA4 연동이 연결되어 있지 않아 주간 퍼널 리포트를 만들지 못했습니다(어드민 → 플랫폼 연동).'
  } else {
    state = 'connected'
    text = buildReportText(await loadGa4Bundle(row))
  }
  const sent = await sendSystemNotification({
    text,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
  })
  return { state, sent }
}
