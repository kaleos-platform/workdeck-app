/** @jest-environment node */
import { sendEmail } from '@/lib/email/send'
import { notifyEmail } from '../lead-notify'

jest.mock('server-only', () => ({}))
jest.mock('@/lib/email/send', () => ({ sendEmail: jest.fn(async () => true) }))

it('도입 신청 알림 — 입력값 escape, text 파트, 휴대폰 마스킹', async () => {
  await notifyEmail({
    deck: 'recruiting',
    deckName: '모집 관리',
    name: '<b>홍</b>',
    phone: '01012345678',
    email: 'ceo@brand.kr',
    companyName: '의식주의',
    position: '대표',
    employeeCount: '10~49명',
  })
  const arg = (sendEmail as jest.Mock).mock.calls[0][0]
  expect(arg.html).not.toContain('<b>홍')
  expect(arg.html).toContain('&lt;b&gt;홍')
  expect(arg.text).toContain('이름: <b>홍</b>')
  expect(arg.text).toContain('010-****-5678')
  expect(arg.html).not.toContain('01012345678')
})
