import 'server-only'

// 도입 신청 알림 — 실패해도 신청 접수는 성공이어야 하므로 호출 측에서 allSettled 로 묶는다.
// sendSystemNotification 은 모든 Space 의 Slack 으로 브로드캐스트되므로 쓰지 않는다.

export type LeadNotifyInput = {
  deck: string
  deckName: string
  name: string
  phone: string
  email: string
  companyName: string
  position: string
  employeeCount: string
}

const TIMEOUT_MS = 5000
const ADMIN_LEADS_URL = 'https://admin.workdeck.work/leads'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeSlack(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 010-****-5678 — 전체 번호는 어드민 화면에서만 본다
function maskPhone(phone: string) {
  return phone.length === 11 ? `${phone.slice(0, 3)}-****-${phone.slice(7)}` : '****'
}

export async function notifySlack(lead: LeadNotifyInput) {
  const url = process.env.LEAD_SLACK_WEBHOOK_URL
  if (!url) return
  const text = [
    `:inbox_tray: 새 도입 신청 (${escapeSlack(lead.deckName)})`,
    `회사: ${escapeSlack(lead.companyName)} (${escapeSlack(lead.employeeCount)})`,
    `담당자: ${escapeSlack(lead.name)} / ${escapeSlack(lead.position)}`,
    `이메일: ${escapeSlack(lead.email)}`,
    `연락처: ${maskPhone(lead.phone)}`,
    `관리: ${ADMIN_LEADS_URL}`,
  ].join('\n')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`slack webhook ${res.status}`)
}

export async function notifyEmail(lead: LeadNotifyInput) {
  const key = process.env.RESEND_API_KEY
  if (!key) return
  const rows: Array<[string, string]> = [
    ['업무', lead.deckName],
    ['회사명', lead.companyName],
    ['직원 수', lead.employeeCount],
    ['이름', lead.name],
    ['직책', lead.position],
    ['이메일', lead.email],
    ['휴대폰', maskPhone(lead.phone)],
  ]
  const html = `<table>${rows
    .map(([k, v]) => `<tr><th align="left">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join('')}</table><p><a href="${ADMIN_LEADS_URL}">${ADMIN_LEADS_URL}</a></p>`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.LEAD_NOTIFY_FROM ?? 'Workdeck <noreply@workdeck.work>',
      to: process.env.LEAD_NOTIFY_TO ?? 'hello@workdeck.work',
      subject: `[도입 신청] ${lead.companyName} (${lead.deckName})`,
      html,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`resend ${res.status}`)
}
