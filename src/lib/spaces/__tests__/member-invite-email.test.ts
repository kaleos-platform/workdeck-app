/** @jest-environment node */
jest.mock('@/lib/email/send', () => ({
  sendEmail: jest.fn(),
  formatFrom: (n: string) => `"${n}" <noreply@workdeck.work>`,
}))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))

import { sendEmail } from '@/lib/email/send'
import { hashInviteToken } from '../invitations'
import { sendMemberInviteEmail } from '../member-invite-email'

const base = {
  to: 'invitee@example.com',
  link: 'https://app.example.com/invite/TOK',
  token: 'TOK',
  invitationId: 'inv-1',
  spaceName: '테스트',
  inviterName: '소유자',
  role: 'ADMIN' as const,
  expiresAt: new Date('2026-11-22T03:00:00Z'),
}

beforeEach(() => (sendEmail as jest.Mock).mockReset().mockResolvedValue(true))

it('제목·발신·링크·역할·만료일·안내를 담아 보낸다', async () => {
  expect(await sendMemberInviteEmail(base)).toBe(true)
  const arg = (sendEmail as jest.Mock).mock.calls[0][0]
  expect(arg.subject).toBe('[워크덱] 소유자님이 「테스트」 작업 공간에 초대했습니다')
  expect(arg.from).toBe('"워크덱" <noreply@workdeck.work>')
  expect(arg.to).toBe('invitee@example.com')
  expect(arg.html).toContain('href="https://app.example.com/invite/TOK"')
  expect(arg.html).toContain('초대 확인하기')
  expect(arg.html).toContain('관리자')
  expect(arg.html).toContain('2026년 11월 22일')
  expect(arg.html).toContain('초대받은 적이 없다면 이 메일을 무시하세요')
  expect(arg.text).toContain('https://app.example.com/invite/TOK')
})

it('이름은 HTML 이스케이프, 제목은 줄바꿈 제거', async () => {
  await sendMemberInviteEmail({
    ...base,
    spaceName: '<b>공간</b>',
    inviterName: '홍\r\n길동',
  })
  const arg = (sendEmail as jest.Mock).mock.calls[0][0]
  expect(arg.html).not.toContain('<b>공간</b>')
  expect(arg.html).toContain('&lt;b&gt;공간&lt;/b&gt;')
  expect(arg.subject).not.toMatch(/[\r\n]/)
})

it('idempotencyKey 는 토큰마다 달라진다', async () => {
  await sendMemberInviteEmail(base)
  await sendMemberInviteEmail({ ...base, token: 'TOK2' })
  const keys = (sendEmail as jest.Mock).mock.calls.map((c) => c[0].idempotencyKey)
  expect(keys[0]).toBe(`invitation:inv-1:${hashInviteToken('TOK').slice(0, 16)}`)
  expect(keys[0]).not.toBe(keys[1])
})

it('RESEND 키 없음(false)은 그대로 false', async () => {
  ;(sendEmail as jest.Mock).mockResolvedValue(false)
  expect(await sendMemberInviteEmail(base)).toBe(false)
})
