// Supabase Auth 메일 템플릿 — 앱 메일과 같은 레이아웃(워크덱 브랜드).
// 대시보드(Authentication → Emails)에 붙여 넣을 원본은 docs/email/auth-templates/*.html 이고,
// supabase-templates.test.ts 가 이 정의와 파일이 같은지 확인한다.
// 갱신: UPDATE_EMAIL_TEMPLATES=1 npx jest src/lib/email/__tests__/supabase-templates.test.ts
// {{ }} 는 GoTrue 템플릿 변수라 그대로 남긴다(escapeHtml 은 중괄호·점을 바꾸지 않는다).
// 링크 유효 시간 「1시간」 = 운영 Auth 설정 mailer_otp_exp 3600초.
import { emailBlocks, renderEmail } from './layout'

type AuthMail = {
  /** Supabase 대시보드 템플릿 이름 */
  dashboard: string
  subject: string
  preheader: string
  heading: string
  body: string[]
  cta: string
  url: string
  footer: string
}

const AUTH_MAILS = {
  confirmation: {
    dashboard: 'Confirm signup',
    subject: '[Workdeck] 이메일 주소를 확인해 주세요',
    preheader: '버튼을 누르면 가입이 완료됩니다.',
    heading: '이메일 주소를 확인해 주세요',
    body: [
      'Workdeck 가입을 마치려면 아래 버튼을 눌러 이메일 주소를 확인해 주세요. 링크는 1시간 동안 유효합니다.',
    ],
    cta: '이메일 확인',
    url: '{{ .ConfirmationURL }}',
    footer: 'Workdeck에 가입한 적이 없다면 이 메일을 무시하세요.',
  },
  invite: {
    dashboard: 'Invite user',
    subject: '[Workdeck] 워크스페이스에 초대되었습니다',
    preheader: '버튼을 눌러 비밀번호를 정하고 참여하세요.',
    heading: '워크스페이스에 초대되었습니다',
    body: [
      'Workdeck 워크스페이스에 초대되었습니다. 아래 버튼을 눌러 비밀번호를 정하고 참여하세요.',
    ],
    cta: '초대 수락하기',
    // src/lib/spaces/invite-email.ts 가 이 주소 형식에 의존한다 — 바꾸지 않는다
    url: '{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next={{ .Data.invite_path }}',
    footer: '초대받을 일이 없다면 이 메일을 무시하세요.',
  },
  magic_link: {
    dashboard: 'Magic link',
    subject: '[Workdeck] 로그인 링크',
    preheader: '버튼을 눌러 로그인하세요.',
    heading: 'Workdeck 로그인',
    body: ['아래 버튼을 눌러 로그인하세요. 링크는 1시간 동안 유효합니다.'],
    cta: '로그인',
    url: '{{ .ConfirmationURL }}',
    footer: '요청하지 않았다면 이 메일을 무시하세요.',
  },
  email_change: {
    dashboard: 'Change email address',
    subject: '[Workdeck] 이메일 변경 확인',
    preheader: '이메일 변경을 확인해 주세요.',
    heading: '이메일 변경 확인',
    // 운영은 secure email change 가 켜져 있어 두 주소 모두 확인해야 바뀐다
    body: [
      'Workdeck 계정 이메일을 아래 주소로 바꾸는 요청을 받았습니다.',
      '{{ .Email }} → {{ .NewEmail }}',
      '기존 주소와 새 주소로 각각 확인 메일이 갑니다. 두 메일에서 모두 확인해야 변경됩니다.',
    ],
    cta: '변경 확인',
    url: '{{ .ConfirmationURL }}',
    footer: '요청하지 않았다면 이 메일을 무시하세요. 이메일은 바뀌지 않습니다.',
  },
  recovery: {
    dashboard: 'Reset password',
    subject: '[Workdeck] 비밀번호 재설정',
    preheader: '버튼을 눌러 새 비밀번호를 설정하세요.',
    heading: '비밀번호 재설정',
    body: ['아래 버튼을 눌러 새 비밀번호를 설정하세요. 링크는 1시간 동안 유효합니다.'],
    cta: '새 비밀번호 설정',
    url: '{{ .ConfirmationURL }}',
    footer: '요청하지 않았다면 이 메일을 무시하세요. 비밀번호는 바뀌지 않습니다.',
  },
} satisfies Record<string, AuthMail>

export type SupabaseTemplateKey = keyof typeof AUTH_MAILS

export function buildSupabaseTemplates() {
  return Object.entries(AUTH_MAILS).map(([key, m]) => ({
    key: key as SupabaseTemplateKey,
    dashboard: m.dashboard,
    subject: m.subject,
    html: renderEmail({
      preheader: m.preheader,
      header: { kind: 'workdeck' },
      body: [
        emailBlocks.heading(m.heading),
        ...m.body.map((b) => emailBlocks.paragraph(b)),
        emailBlocks.button(m.cta, m.url),
        emailBlocks.fallbackLink(m.url),
      ],
      footer: [m.footer, 'Workdeck · workdeck.work'],
    }),
  }))
}
