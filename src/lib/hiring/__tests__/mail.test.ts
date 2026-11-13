/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email/send'
import {
  buildDigestEmail,
  buildReceiptEmail,
  kstPreviousDay,
  runDailyDigest,
  sendApplicantReceipt,
} from '../mail'
import { dailyDigestPostingWhere } from '../mail-settings'

jest.mock('server-only', () => ({}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringApplication: { findFirst: jest.fn(), groupBy: jest.fn() },
    hiringPosting: { findMany: jest.fn() },
    spaceMember: { findMany: jest.fn() },
    hiringDailyDigestLog: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}))
const decrypted = { value: 'applicant@example.com' }
jest.mock('@/lib/del/encryption', () => ({ decryptPii: () => decrypted.value }))
jest.mock('@/lib/email/send', () => {
  const actual = jest.requireActual('@/lib/email/send')
  return { ...actual, sendEmail: jest.fn(async () => true) }
})

const p = prisma as unknown as {
  hiringApplication: { findFirst: jest.Mock; groupBy: jest.Mock }
  hiringPosting: { findMany: jest.Mock }
  spaceMember: { findMany: jest.Mock }
  hiringDailyDigestLog: {
    create: jest.Mock
    update: jest.Mock
    delete: jest.Mock
    updateMany: jest.Mock
    findUnique: jest.Mock
  }
}
const send = sendEmail as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

const author = { userId: 'u1', role: 'MEMBER', user: { email: 'manager@brand.kr' } }

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app1',
    createdAt: new Date('2026-11-13T05:05:00Z'),
    emailEnc: 'enc',
    emailIv: 'iv',
    posting: {
      title: '주말 홀 매니저',
      spaceId: 's1',
      authorUserId: 'u1',
      mailSetting: null,
      space: { name: '카페 "오렌지"' },
    },
    ...overrides,
  }
}

describe('buildReceiptEmail', () => {
  it('공고명·접수 시각(KST)·문의 안내만 담는다', () => {
    const mail = buildReceiptEmail({
      postingTitle: '<b>홀</b> 매니저',
      submittedAt: new Date('2026-11-13T05:05:00Z'),
      hasReplyTo: true,
    })
    expect(mail.subject).toContain('<b>홀</b> 매니저')
    expect(mail.html).toContain('&lt;b&gt;홀&lt;/b&gt;')
    expect(mail.text).toContain('2026년 11월 13일 14:05')
    expect(mail.text).toContain('회신')
  })
})

describe('sendApplicantReceipt', () => {
  it('브랜드 via Workdeck 발신, Reply-To 는 공고 담당자', async () => {
    p.hiringApplication.findFirst.mockResolvedValue(application())
    p.spaceMember.findMany.mockResolvedValue([author])
    await sendApplicantReceipt('app1')
    expect(send).toHaveBeenCalledTimes(1)
    const arg = send.mock.calls[0][0]
    expect(arg.from).toBe('"카페 오렌지 via Workdeck" <noreply@workdeck.work>')
    expect(arg.to).toBe('applicant@example.com')
    expect(arg.replyTo).toEqual(['manager@brand.kr'])
    expect(arg.idempotencyKey).toBe('hiring-receipt/app1')
  })

  it('작성자가 멤버가 아니면 관리자에게 회신이 간다', async () => {
    p.hiringApplication.findFirst.mockResolvedValue(application())
    p.spaceMember.findMany.mockResolvedValue([
      { userId: 'owner', role: 'OWNER', user: { email: 'owner@brand.kr' } },
      { userId: 'm2', role: 'MEMBER', user: { email: 'member@brand.kr' } },
    ])
    await sendApplicantReceipt('app1')
    expect(send.mock.calls[0][0].replyTo).toEqual(['owner@brand.kr'])
  })

  it('이메일 형식이 아니거나 여러 주소면 보내지 않는다', async () => {
    p.hiringApplication.findFirst.mockResolvedValue(application())
    p.spaceMember.findMany.mockResolvedValue([author])
    decrypted.value = 'a@x.com, b@y.com'
    await sendApplicantReceipt('app1')
    decrypted.value = 'applicant@example.com'
    expect(send).not.toHaveBeenCalled()
  })

  it('지원자 이메일이 없으면 보내지 않는다', async () => {
    p.hiringApplication.findFirst.mockResolvedValue(application({ emailEnc: null, emailIv: null }))
    await sendApplicantReceipt('app1')
    expect(send).not.toHaveBeenCalled()
  })

  it('공고 토글이 꺼져 있으면 보내지 않는다', async () => {
    const app = application()
    ;(app.posting as Record<string, unknown>).mailSetting = { applicantReceiptEmail: false }
    p.hiringApplication.findFirst.mockResolvedValue(app)
    await sendApplicantReceipt('app1')
    expect(send).not.toHaveBeenCalled()
  })

  it('발송 실패는 throw 하지 않고 개인정보 없이 로깅한다', async () => {
    p.hiringApplication.findFirst.mockResolvedValue(application())
    p.spaceMember.findMany.mockResolvedValue([author])
    send.mockRejectedValueOnce(new Error('resend 500'))
    await expect(sendApplicantReceipt('app1')).resolves.toBeUndefined()
    expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain('applicant@')
  })
})

describe('kstPreviousDay', () => {
  it('KST 09시 실행 → 전날 KST 0~24시', () => {
    const r = kstPreviousDay(new Date('2026-11-13T00:00:00Z'))
    expect(r.date).toBe('2026-11-12')
    expect(r.start.toISOString()).toBe('2026-11-11T15:00:00.000Z')
    expect(r.end.toISOString()).toBe('2026-11-12T15:00:00.000Z')
  })
})

describe('buildDigestEmail', () => {
  it('공고별 건수와 링크만 담는다', () => {
    const mail = buildDigestEmail('2026-11-12', [
      { title: 'A 공고', count: 3, url: 'https://app/x?posting=p1' },
      { title: 'B 공고', count: 1, url: 'https://app/x?posting=p2' },
    ])
    expect(mail.subject).toContain('4명')
    expect(mail.text).toContain('A 공고: 3명')
    expect(mail.html).toContain('https://app/x?posting=p1')
  })
})

describe('runDailyDigest', () => {
  const now = new Date('2026-11-13T00:00:00Z')

  beforeEach(() => {
    p.hiringApplication.groupBy.mockResolvedValue([
      { postingId: 'p1', _count: { _all: 2 } },
      { postingId: 'p2', _count: { _all: 1 } },
    ])
    p.hiringPosting.findMany.mockResolvedValue([
      { id: 'p1', title: 'A 공고', spaceId: 's1', authorUserId: 'u1' },
      { id: 'p2', title: 'B 공고', spaceId: 's1', authorUserId: 'u1' },
    ])
    p.spaceMember.findMany.mockResolvedValue([author])
    p.hiringDailyDigestLog.create.mockResolvedValue({ id: 'log1' })
    p.hiringDailyDigestLog.delete.mockResolvedValue({})
  })

  it('알림 켠 공고의 전날 지원만 집계해 담당자당 1통', async () => {
    const result = await runDailyDigest(now)
    const where = p.hiringApplication.groupBy.mock.calls[0][0].where
    expect(where.posting).toBe(dailyDigestPostingWhere)
    expect(where.deletedAt).toBeNull()
    expect(where.createdAt.gte.toISOString()).toBe('2026-11-11T15:00:00.000Z')
    expect(send).toHaveBeenCalledTimes(1)
    const arg = send.mock.calls[0][0]
    expect(arg.to).toBe('manager@brand.kr')
    expect(arg.idempotencyKey).toBe('hiring-digest/u1/2026-11-12')
    expect(p.hiringDailyDigestLog.update).toHaveBeenCalled()
    expect(result).toMatchObject({ date: '2026-11-12', sent: 1, skipped: 0, failed: 0 })
  })

  it('전날 새 지원자가 없으면 아무에게도 보내지 않는다', async () => {
    p.hiringApplication.groupBy.mockResolvedValue([])
    const result = await runDailyDigest(now)
    expect(p.hiringPosting.findMany).not.toHaveBeenCalled()
    expect(p.hiringDailyDigestLog.create).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(result).toMatchObject({ recipients: 0, sent: 0 })
  })

  it('새 지원자가 있는 공고의 담당자에게만 보낸다(0명 공고 담당자 제외)', async () => {
    // 집계(groupBy)에는 지원이 있는 공고 p1 만 나온다 — p2(담당자 u2)는 0명
    p.hiringApplication.groupBy.mockResolvedValue([{ postingId: 'p1', _count: { _all: 1 } }])
    p.hiringPosting.findMany.mockResolvedValue([
      { id: 'p1', title: 'A 공고', spaceId: 's1', authorUserId: 'u1' },
    ])
    await runDailyDigest(now)
    expect(p.hiringPosting.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['p1'] } })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].to).toBe('manager@brand.kr')
    expect(send.mock.calls[0][0].text).not.toContain('0명')
  })

  it('이미 발송 기록이 있으면 건너뛴다', async () => {
    p.hiringDailyDigestLog.create.mockRejectedValue({ code: 'P2002' })
    p.hiringDailyDigestLog.updateMany.mockResolvedValue({ count: 0 })
    const result = await runDailyDigest(now)
    expect(send).not.toHaveBeenCalled()
    expect(result).toMatchObject({ sent: 0, skipped: 1 })
  })

  it('30분 넘게 발송 중으로 남은 선점은 다시 가져가 보낸다', async () => {
    p.hiringDailyDigestLog.create.mockRejectedValue({ code: 'P2002' })
    p.hiringDailyDigestLog.updateMany.mockResolvedValue({ count: 1 })
    p.hiringDailyDigestLog.findUnique.mockResolvedValue({ id: 'old' })
    const result = await runDailyDigest(now)
    const where = p.hiringDailyDigestLog.updateMany.mock.calls[0][0].where
    expect(where.sentAt).toBeNull()
    expect(where.createdAt.lt.toISOString()).toBe('2026-11-12T23:30:00.000Z')
    expect(p.hiringDailyDigestLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'old' } })
    )
    expect(result).toMatchObject({ sent: 1 })
  })

  it('메일 키가 없어 못 보냈으면 실패로 남기고 기록을 지운다', async () => {
    send.mockResolvedValueOnce(false)
    const result = await runDailyDigest(now)
    expect(p.hiringDailyDigestLog.update).not.toHaveBeenCalled()
    expect(p.hiringDailyDigestLog.delete).toHaveBeenCalled()
    expect(result).toMatchObject({ sent: 0, failed: 1 })
  })

  it('발송 실패 시 기록을 지워 재시도할 수 있게 한다', async () => {
    send.mockRejectedValueOnce(new Error('resend 500'))
    const result = await runDailyDigest(now)
    expect(p.hiringDailyDigestLog.delete).toHaveBeenCalledWith({ where: { id: 'log1' } })
    expect(result).toMatchObject({ sent: 0, failed: 1 })
  })

  it('지원자 개인정보 컬럼을 조회하지 않는다', async () => {
    await runDailyDigest(now)
    const args = JSON.stringify(p.hiringApplication.groupBy.mock.calls)
    expect(args).not.toMatch(/name|phone|email|address|Enc/)
  })
})

describe('queueApplicantReceipt', () => {
  it('요청 범위 밖이라 after 가 실패해도 throw 하지 않는다', async () => {
    const { queueApplicantReceipt } = await import('../mail')
    expect(() => queueApplicantReceipt('app1')).not.toThrow()
  })
})

describe('formatFrom', () => {
  it('제어문자 제거·코드포인트 단위 절단', async () => {
    const { formatFrom } = jest.requireActual('@/lib/email/send')
    expect(formatFrom('A\u0000B\r\nC')).toBe('"A B C" <noreply@workdeck.work>')
    const long = formatFrom('😀'.repeat(100))
    expect(long).toBe(`"${'😀'.repeat(80)}" <noreply@workdeck.work>`)
  })
})
