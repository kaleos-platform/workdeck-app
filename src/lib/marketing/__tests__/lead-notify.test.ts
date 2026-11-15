/** @jest-environment node */
import { sendEmail } from '@/lib/email/send'
import { notifyApplicant, notifyEmail } from '../lead-notify'

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

const lead = {
  deck: 'recruiting',
  deckName: '모집 관리',
  name: '<b>홍</b>',
  phone: '01012345678',
  email: 'ceo@brand.kr',
  companyName: '의식주의 evil.example 확인',
  position: '대표',
  employeeCount: '10~49명',
}

describe('신청자 접수 확인 메일', () => {
  beforeEach(() => (sendEmail as jest.Mock).mockClear())

  it('공개 업무: 도입 신청 접수 제목·24시간 안내·바로 시작 버튼, 신청자에게 회신은 운영 주소로', async () => {
    await notifyApplicant(lead, { released: true, now: new Date('2026-11-16T03:00:00Z') })
    const arg = (sendEmail as jest.Mock).mock.calls[0][0]
    expect(arg.to).toBe('ceo@brand.kr')
    expect(arg.subject).toContain('모집 관리 도입 신청이 접수됐습니다')
    expect(arg.replyTo).toBe('hello@workdeck.work')
    expect(arg.html).toContain('24시간')
    expect(arg.html).toContain('바로 시작하기')
    expect(arg.html).toContain(encodeURIComponent('/my-deck?subscribe=recruiting'))
    expect(arg.text).toContain('24시간')
  })

  it('준비중 업무: 출시 알림 접수 문구, 바로 시작 버튼 없음', async () => {
    await notifyApplicant({ ...lead, deck: 'finance', deckName: '재무 관리' }, { released: false })
    const arg = (sendEmail as jest.Mock).mock.calls[0][0]
    expect(arg.subject).toContain('재무 관리 출시 알림 신청이 접수됐습니다')
    expect(arg.html).toContain('출시되면')
    expect(arg.html).not.toContain('바로 시작하기')
  })

  it('신청자가 입력한 글(이름·회사명·연락처·이메일)은 본문에 한 글자도 넣지 않는다', async () => {
    await notifyApplicant(lead, { released: true })
    const arg = (sendEmail as jest.Mock).mock.calls[0][0]
    for (const part of [arg.html, arg.text, arg.subject]) {
      expect(part).not.toContain('홍')
      expect(part).not.toContain('evil.example')
      expect(part).not.toContain('의식주의')
      expect(part).not.toContain('01012345678')
      expect(part).not.toContain('ceo@brand.kr')
    }
  })

  it('같은 주소·업무는 KST 하루 1통 (멱등 키)', async () => {
    await notifyApplicant(lead, { released: true, now: new Date('2026-11-16T14:59:00Z') })
    await notifyApplicant(lead, { released: true, now: new Date('2026-11-16T15:01:00Z') })
    const [a, b] = (sendEmail as jest.Mock).mock.calls.map((c) => c[0].idempotencyKey)
    expect(a).toBe('lead-confirm:recruiting:ceo@brand.kr:2026-11-16')
    expect(b).toBe('lead-confirm:recruiting:ceo@brand.kr:2026-11-17')
  })
})
