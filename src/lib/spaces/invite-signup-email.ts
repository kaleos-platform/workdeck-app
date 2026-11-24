import 'server-only'
import { emailBlocks, renderEmail } from '@/lib/email/layout'
import { formatFrom, sendEmail } from '@/lib/email/send'
import { hashInviteToken } from '@/lib/spaces/invitations'

const oneLine = (v: string) => v.replace(/[\r\n\u0000-\u001f]+/g, ' ').trim()

/** 초대 링크로 들어온 사람에게 보내는 이메일 인증 메일(Resend). 보냈으면 true, 키 없음은 false, 실패는 throw. */
export async function sendInviteSignupEmail(input: {
  to: string
  link: string
  token: string
  invitationId: string
  spaceName: string
}): Promise<boolean> {
  const space = oneLine(input.spaceName)
  const html = renderEmail({
    preheader: `「${space}」 참여를 위해 이메일을 인증해 주세요`,
    header: { kind: 'space', name: space },
    body: [
      emailBlocks.heading('이메일을 인증해 주세요'),
      emailBlocks.paragraph(
        `「${space}」 작업 공간에 참여하려면 아래 버튼으로 이메일을 인증하세요. 인증 뒤 비밀번호를 정하면 참여할 수 있습니다.`
      ),
      emailBlocks.button('이메일 인증하고 참여하기', input.link),
      emailBlocks.paragraph('이 링크는 1시간 동안 유효합니다.', { muted: true }),
      emailBlocks.fallbackLink(input.link),
    ],
    footer: [
      '요청한 적이 없다면 이 메일을 무시하세요. 인증하기 전에는 아무 변경도 없습니다.',
      '이 메일은 발신 전용입니다.',
    ],
  })
  const text = [
    `「${space}」 작업 공간에 참여하려면 이메일을 인증하세요.`,
    '',
    `이메일 인증하고 참여하기: ${input.link}`,
    '이 링크는 1시간 동안 유효합니다.',
    '',
    '요청한 적이 없다면 이 메일을 무시하세요.',
  ].join('\n')
  return sendEmail({
    from: formatFrom('워크덱'),
    to: input.to,
    subject: `[워크덱] 「${space}」 참여를 위한 이메일 인증`,
    html,
    text,
    // 요청마다 링크가 달라지므로 시각을 섞어 재요청이 합쳐지지 않게 한다.
    idempotencyKey: `invite-signup:${input.invitationId}:${hashInviteToken(input.token).slice(0, 8)}:${Date.now()}`,
  })
}
