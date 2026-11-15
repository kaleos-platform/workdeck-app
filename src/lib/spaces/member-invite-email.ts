import 'server-only'
import { emailBlocks, renderEmail } from '@/lib/email/layout'
import { formatFrom, sendEmail } from '@/lib/email/send'
import { hashInviteToken } from '@/lib/spaces/invitations'

const ROLE_LABEL = { ADMIN: '관리자', MEMBER: '구성원' } as const

const oneLine = (v: string) => v.replace(/[\r\n\u0000-\u001f]+/g, ' ').trim()

/** 이미 가입한 이메일에 보내는 작업 공간 초대 메일(Resend). 보냈으면 true, 키 없음은 false, 실패는 throw. */
export async function sendMemberInviteEmail(input: {
  to: string
  link: string
  token: string
  invitationId: string
  spaceName: string
  inviterName: string
  role: 'ADMIN' | 'MEMBER'
  expiresAt: Date
}): Promise<boolean> {
  const space = oneLine(input.spaceName)
  const inviter = oneLine(input.inviterName)
  const expires = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(input.expiresAt)
  const role = ROLE_LABEL[input.role]
  const subject = `[워크덱] ${inviter}님이 「${space}」 작업 공간에 초대했습니다`
  const html = renderEmail({
    preheader: `${inviter}님이 「${space}」 작업 공간에 초대했습니다`,
    header: { kind: 'space', name: space },
    body: [
      emailBlocks.heading('작업 공간에 초대받았습니다'),
      emailBlocks.paragraph(`${inviter}님이 「${space}」 작업 공간에 초대했습니다.`),
      emailBlocks.details([
        ['작업 공간', space],
        ['역할', role],
        ['초대한 사람', inviter],
        ['만료일', expires],
      ]),
      emailBlocks.button('초대 확인하기', input.link),
      emailBlocks.paragraph(
        `이 이메일(${input.to})로 워크덱에 로그인한 상태에서 초대를 수락하세요.`,
        { muted: true }
      ),
      emailBlocks.fallbackLink(input.link),
    ],
    footer: [
      '초대받은 적이 없다면 이 메일을 무시하세요. 수락하기 전에는 아무 변경도 없습니다.',
      '이 메일은 발신 전용입니다.',
    ],
  })
  const text = [
    `${inviter}님이 「${space}」 작업 공간에 초대했습니다.`,
    `역할: ${role}`,
    `만료일: ${expires}`,
    '',
    `초대 확인하기: ${input.link}`,
    `이 이메일(${input.to})로 워크덱에 로그인한 상태에서 초대를 수락하세요.`,
    '',
    '초대받은 적이 없다면 이 메일을 무시하세요.',
  ].join('\n')
  return sendEmail({
    from: formatFrom('워크덱'),
    to: input.to,
    subject,
    html,
    text,
    // 토큰이 재발급될 때마다 달라진다 — 다시 보낸 메일이 이전 요청과 합쳐지지 않는다.
    idempotencyKey: `invitation:${input.invitationId}:${hashInviteToken(input.token).slice(0, 16)}`,
  })
}
