import { emailBlocks, renderEmail } from '@/lib/email/layout'

export const LEAD_INVITE_TITLE = '워크덱 이용을 안내드립니다'
export const LEAD_INVITE_INTRO =
  '도입 문의를 남겨 주셔서 감사합니다. 아래 버튼으로 가입하고 필요한 업무를 시작해 보세요.'
export const LEAD_INVITE_INSTRUCTION = '도입 문의에 남긴 이 이메일로 가입해 주세요.'
export const LEAD_INVITE_FOOTER = '문의는 이 메일에 회신해 주세요.'

/** 운영자 미리보기와 실제 발송이 같은 본문을 쓴다. 메시지는 emailBlocks에서 이스케이프한다. */
export function renderLeadInviteEmail(message: string, signupUrl: string) {
  return renderEmail({
    preheader: LEAD_INVITE_TITLE,
    header: { kind: 'workdeck', label: '가입 안내' },
    body: [
      emailBlocks.heading(LEAD_INVITE_TITLE),
      emailBlocks.paragraph(LEAD_INVITE_INTRO),
      ...(message ? message.split(/\r?\n/).map((line) => emailBlocks.paragraph(line)) : []),
      emailBlocks.paragraph(LEAD_INVITE_INSTRUCTION, { muted: true }),
      emailBlocks.button('가입하기', signupUrl),
    ],
    footer: [LEAD_INVITE_FOOTER],
  })
}

export function leadInviteText(message: string, signupUrl: string) {
  return [
    LEAD_INVITE_TITLE,
    '',
    LEAD_INVITE_INTRO,
    ...(message ? ['', message] : []),
    '',
    LEAD_INVITE_INSTRUCTION,
    `가입하기: ${signupUrl}`,
    '',
    LEAD_INVITE_FOOTER,
  ].join('\n')
}
