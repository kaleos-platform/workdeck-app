import 'server-only'
import { buildAdminUrl } from '@/lib/domain'
import { sendEmail } from '@/lib/email/send'
import { emailBlocks, renderEmail } from '@/lib/email/layout'

// 도입 신청 알림 — 실패해도 신청 접수는 성공이어야 하므로 호출 측에서 allSettled 로 묶는다.
// 리드는 전용 웹훅 채널로 보낸다(sendSystemNotification 은 운영 Space 채널용).

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
const ADMIN_LEADS_URL = buildAdminUrl('/admin/leads')
// preview·로컬 신청은 운영 채널·메일에서 구분되도록 제목 앞에 환경을 붙인다
const ENV_PREFIX =
  process.env.VERCEL_ENV === 'production'
    ? ''
    : `[${(process.env.VERCEL_ENV ?? 'local').toUpperCase()}] `

// 운영 수신 주소 — 운영 알림 수신처이자 신청자 메일의 회신 주소
const OPS_ADDRESS = () => process.env.LEAD_NOTIFY_TO ?? 'hello@workdeck.work'

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
    `${ENV_PREFIX}:inbox_tray: 새 도입 신청 (${escapeSlack(lead.deckName)})`,
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
  const rows: Array<[string, string]> = [
    ['업무', lead.deckName],
    ['회사명', lead.companyName],
    ['직원 수', lead.employeeCount],
    ['이름', lead.name],
    ['직책', lead.position],
    ['이메일', lead.email],
    ['휴대폰', maskPhone(lead.phone)],
  ]
  const html = renderEmail({
    preheader: `${lead.companyName} · ${lead.deckName}`,
    header: { kind: 'workdeck', label: '운영 알림' },
    body: [
      emailBlocks.heading('새 도입 신청'),
      emailBlocks.details(rows),
      emailBlocks.button('어드민에서 보기', ADMIN_LEADS_URL),
    ],
    footer: ['운영자에게만 발송되는 내부 알림입니다.'],
  })
  const text = [
    '새 도입 신청',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `어드민에서 보기: ${ADMIN_LEADS_URL}`,
  ].join('\n')
  await sendEmail({
    from: process.env.LEAD_NOTIFY_FROM ?? 'Workdeck <noreply@workdeck.work>',
    to: OPS_ADDRESS(),
    subject: `${ENV_PREFIX}[도입 신청] ${lead.companyName} (${lead.deckName})`,
    html,
    text,
  })
}

/** KST 날짜(YYYY-MM-DD) — 같은 주소·업무 확인 메일을 하루 1통으로 묶는 멱등 키에 쓴다 */
function kstDate(now: Date) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 신청자 접수 확인 메일. 누구나 남의 주소를 넣을 수 있으므로 신청자가 입력한 글(이름·회사명 등)은
 * 한 글자도 넣지 않는다 — 워크덱 발신 메일에 임의 문구(피싱 URL 등)가 실리는 것을 막는다.
 * 본문은 업무명(서버 값)과 공개 여부만으로 정해지고, 같은 주소·업무는 Resend 멱등 키로 하루 1통.
 * 공개 여부(released)는 호출 측이 서버에서 판정한다.
 */
export async function notifyApplicant(
  lead: Pick<LeadNotifyInput, 'deck' | 'deckName' | 'email'>,
  opts: { released: boolean; signupUrl?: string; now?: Date }
) {
  const startUrl = opts.signupUrl
  const kind = opts.released ? '도입 신청' : '출시 알림 신청'
  const next = opts.released
    ? '담당자가 확인 후 24시간 안에 이 메일 주소로 이용 방법을 안내드립니다.'
    : '업무가 출시되면 이 메일 주소로 가장 먼저 알려드립니다.'
  const title = `${lead.deckName} ${kind}이 접수됐습니다`
  const html = renderEmail({
    preheader: title,
    header: { kind: 'workdeck', label: kind },
    body: [
      emailBlocks.heading(title),
      emailBlocks.paragraph(`워크덱에 관심 가져 주셔서 감사합니다. ${next}`),
      ...(opts.released && startUrl
        ? [
            emailBlocks.paragraph(
              '신청한 이메일로 가입해 주세요. 가입 후 곧장 시작할 수 있습니다.',
              { muted: true }
            ),
            emailBlocks.button('바로 시작하기', startUrl),
          ]
        : []),
    ],
    footer: [
      '문의는 이 메일에 회신해 주세요.',
      '본인이 신청하지 않았다면 이 메일은 무시하셔도 됩니다.',
    ],
  })
  const text = [
    title,
    '',
    `워크덱에 관심 가져 주셔서 감사합니다. ${next}`,
    ...(opts.released && startUrl
      ? ['', '신청한 이메일로 가입해 주세요.', `바로 시작하기: ${startUrl}`]
      : []),
    '',
    '문의는 이 메일에 회신해 주세요. 본인이 신청하지 않았다면 이 메일은 무시하셔도 됩니다.',
  ].join('\n')
  await sendEmail({
    from: process.env.LEAD_NOTIFY_FROM ?? 'Workdeck <noreply@workdeck.work>',
    to: lead.email,
    replyTo: OPS_ADDRESS(),
    subject: `${ENV_PREFIX}[워크덱] ${title}`,
    html,
    text,
    // email 은 검증 스키마에서 이미 소문자·trim 처리된다
    idempotencyKey: `lead-confirm:${lead.deck}:${lead.email}:${kstDate(opts.now ?? new Date())}`,
  })
}
