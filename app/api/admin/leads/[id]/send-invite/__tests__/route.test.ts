/** @jest-environment node */
import { NextResponse } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { sendEmail } from '@/lib/email/send'

jest.mock('@/lib/admin/auth', () => ({ requireOperator: jest.fn(), writeAuditLog: jest.fn() }))
jest.mock('@/lib/email/send', () => ({ sendEmail: jest.fn() }))
jest.mock('@/lib/marketing/lead-signup', () => {
  const actual = jest.requireActual('@/lib/marketing/lead-signup')
  return {
    ...actual,
    leadSignupUrl: (id: string, redirectTo?: string) =>
      `https://app.test/signup?lead=${id}.signed${redirectTo ? `&redirectTo=${encodeURIComponent(redirectTo)}` : ''}`,
  }
})
jest.mock('@/lib/prisma', () => {
  const p = {
    marketingLead: { findUnique: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  }
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p))
  return { prisma: p }
})
const lead = { id: 'lead-first', email: ' Person@Example.com ', status: 'NEW' }
const call = (message = '', id = 'lead-first') =>
  POST(
    new Request('https://admin.test/api/admin/leads/id/send-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }),
    { params: Promise.resolve({ id }) }
  )
beforeEach(() => {
  jest.clearAllMocks()
  jest
    .mocked(requireOperator)
    .mockResolvedValue({ ok: true, user: { id: 'operator', email: 'ops@example.com' } })
  jest.mocked(prisma.marketingLead.findUnique).mockResolvedValue(lead as never)
  jest.mocked(prisma.marketingLead.findFirst).mockResolvedValue(lead as never)
  jest.mocked(prisma.marketingLead.updateMany).mockResolvedValue({ count: 1 })
  jest.mocked(sendEmail).mockResolvedValue(true)
})
it('운영자 권한을 먼저 검사한다', async () => {
  jest.mocked(requireOperator).mockResolvedValue({
    ok: false,
    reason: 'NOT_OPERATOR',
    response: NextResponse.json({}, { status: 404 }),
  })
  expect((await call()).status).toBe(404)
  expect(prisma.marketingLead.findUnique).not.toHaveBeenCalled()
  expect(sendEmail).not.toHaveBeenCalled()
})
it('없는 신청·종료 신청·300자 초과 메시지는 보내지 않는다', async () => {
  jest.mocked(prisma.marketingLead.findUnique).mockResolvedValueOnce(null)
  expect((await call()).status).toBe(404)
  jest
    .mocked(prisma.marketingLead.findUnique)
    .mockResolvedValueOnce({ ...lead, status: 'DROPPED' } as never)
  expect((await call()).status).toBe(409)
  expect((await call('a'.repeat(301))).status).toBe(400)
  expect(sendEmail).not.toHaveBeenCalled()
})
it('고정 본문·서명 링크·escaped 일반 메시지를 보내고 NEW만 CONTACTED로 전환한다', async () => {
  expect((await call('<b>안내</b> https://evil.example')).status).toBe(200)
  const sent = jest.mocked(sendEmail).mock.calls[0][0]
  expect(sent.to).toBe('person@example.com')
  expect(sent.replyTo).toBe('hello@workdeck.work')
  expect(sent.html).toContain(
    'https://app.test/signup?lead=lead-first.signed&amp;redirectTo=%2Fmy-deck'
  )
  expect(sent.html).toContain('&lt;b&gt;안내&lt;/b&gt; https://evil.example')
  expect(sent.html).not.toContain('href="https://evil.example')
  expect(prisma.marketingLead.updateMany).toHaveBeenCalledWith({
    where: { email: { equals: 'person@example.com', mode: 'insensitive' }, status: 'NEW' },
    data: { status: 'CONTACTED' },
  })
  expect(prisma.marketingLead.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ status: { not: 'DROPPED' } }),
      data: { invitedAt: expect.any(Date), invitedBy: 'operator' },
    })
  )
})
it('중복 행·대소문자 주소가 달라도 같은 KST 날짜 멱등 키와 본문을 쓴다', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-25T15:01:00Z'))
  try {
    await call('같은 안내')
    jest
      .mocked(prisma.marketingLead.findUnique)
      .mockResolvedValue({ ...lead, id: 'lead-duplicate', email: 'person@example.com' } as never)
    await call('같은 안내', 'lead-duplicate')
    const [a, b] = jest.mocked(sendEmail).mock.calls.map(([arg]) => arg)
    expect(a.idempotencyKey).toBe(b.idempotencyKey)
    expect(a.idempotencyKey).toMatch(/:2026-11-26$/)
    expect(a.html).toBe(b.html)
  } finally {
    jest.useRealTimers()
  }
})
it('메일 설정 없음(false)이나 발송 실패면 상태와 발송 기록을 남기지 않는다', async () => {
  jest.mocked(sendEmail).mockResolvedValueOnce(false)
  expect((await call()).status).toBe(503)
  jest.mocked(sendEmail).mockRejectedValueOnce(new Error('resend 500'))
  expect((await call()).status).toBe(502)
  expect(prisma.marketingLead.updateMany).not.toHaveBeenCalled()
})
it('같은 날 바뀐 메일 본문 충돌은 재발송하지 않고 409 안내를 준다', async () => {
  jest.mocked(sendEmail).mockRejectedValueOnce(new Error('resend 409'))
  const res = await call('바뀐 내용')
  expect(res.status).toBe(409)
  expect(await res.text()).toContain('같은 날')
  expect(prisma.marketingLead.updateMany).not.toHaveBeenCalled()
})
it('발송 후 DB 실패는 메일 가능성과 동일 메시지 재시도 안내를 보낸다', async () => {
  jest.mocked(prisma.marketingLead.updateMany).mockRejectedValueOnce(new Error('db failed'))
  const res = await call('안내')
  expect(res.status).toBe(500)
  expect(await res.text()).toContain('메일은 나갔을 수')
  expect(sendEmail).toHaveBeenCalledTimes(1)
})

it('같은 KST 날짜 발송이 기록됐으면 다른 운영자의 재클릭도 원본 기록을 유지한다', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-25T02:00:00Z'))
  try {
    const recordedAt = new Date('2026-11-25T01:00:00Z')
    jest
      .mocked(prisma.marketingLead.findFirst)
      .mockResolvedValue({ ...lead, invitedAt: recordedAt, invitedBy: 'first-operator' } as never)
    jest
      .mocked(requireOperator)
      .mockResolvedValue({ ok: true, user: { id: 'second-operator', email: 'second@example.com' } })
    const res = await call('같은 안내')
    expect(await res.json()).toEqual({ ok: true, alreadySent: true })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(prisma.marketingLead.updateMany).not.toHaveBeenCalled()
    expect(writeAuditLog).not.toHaveBeenCalled()
  } finally {
    jest.useRealTimers()
  }
})
it('동시 요청 중 receipt claim을 얻은 경우만 상태·이력·감사를 기록한다', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-25T15:01:00Z'))
  try {
    jest.mocked(prisma.marketingLead.updateMany).mockResolvedValueOnce({ count: 0 })
    const res = await call('안내')
    expect(await res.json()).toEqual({ ok: true, alreadySent: true })
    expect(prisma.marketingLead.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.marketingLead.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'lead-first',
        OR: [{ invitedAt: null }, { invitedAt: { lt: new Date('2026-11-25T15:00:00Z') } }],
      },
      data: { invitedAt: new Date('2026-11-25T15:01:00Z'), invitedBy: 'operator' },
    })
    expect(writeAuditLog).not.toHaveBeenCalled()
  } finally {
    jest.useRealTimers()
  }
})
it('발송 뒤 DB 실패했어도 같은 메시지 재시도로 receipt와 감사를 복구한다', async () => {
  jest.mocked(prisma.marketingLead.updateMany).mockRejectedValueOnce(new Error('db failed'))
  expect((await call('원래 메시지')).status).toBe(500)
  expect((await call('원래 메시지')).status).toBe(200)
  const [a, b] = jest.mocked(sendEmail).mock.calls.map(([input]) => input)
  expect(a.idempotencyKey).toBe(b.idempotencyKey)
  expect(a.html).toBe(b.html)
  expect(writeAuditLog).toHaveBeenCalledTimes(1)
})
