/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: { marketingLead: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() } },
}))
import { prisma } from '@/lib/prisma'
import {
  findSignupLead,
  isLeadGateEnabled,
  leadSignupSource,
  markLeadsContacted,
  markLeadsConverted,
  signLeadToken,
  verifyLeadToken,
} from '../lead-signup'

const lead = {
  id: 'lead-1',
  email: 'a@example.com',
  status: 'NEW',
  utm: { utm_source: 'google', utm_medium: 'cpc' },
  referrer: 'https://example.com/path',
  createdAt: new Date('2026-01-01'),
}
beforeEach(() => {
  jest.clearAllMocks()
  process.env.ENCRYPTION_KEY = 'ab'.repeat(32)
  delete process.env.SIGNUP_REQUIRES_LEAD
})
afterEach(() => {
  delete process.env.ENCRYPTION_KEY
  delete process.env.SIGNUP_REQUIRES_LEAD
})
it('종료를 제외하고 대소문자 무시 이메일의 가장 오래된 리드를 찾는다', async () => {
  jest.mocked(prisma.marketingLead.findFirst).mockResolvedValue(null)
  expect(await findSignupLead(' A@EXAMPLE.COM ')).toBeNull()
  expect(prisma.marketingLead.findFirst).toHaveBeenCalledWith({
    where: { email: { equals: 'a@example.com', mode: 'insensitive' }, status: { not: 'DROPPED' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
})
it('utm 없는 리드도 referrer·lead 출처를 보존한다', () => {
  expect(leadSignupSource(lead)).toMatchObject({
    utm_source: 'google',
    landing: 'lead',
    referrer: lead.referrer,
  })
  expect(leadSignupSource({ ...lead, utm: null, referrer: null })).toMatchObject({
    landing: 'lead',
  })
})
it('전환은 NEW·CONTACTED만, 연락은 NEW만 조건부 갱신한다', async () => {
  await markLeadsConverted('A@EXAMPLE.COM', prisma)
  expect(prisma.marketingLead.updateMany).toHaveBeenLastCalledWith({
    where: {
      email: { equals: 'a@example.com', mode: 'insensitive' },
      status: { in: ['NEW', 'CONTACTED'] },
    },
    data: { status: 'CONVERTED' },
  })
  await markLeadsContacted('A@EXAMPLE.COM')
  expect(prisma.marketingLead.updateMany).toHaveBeenLastCalledWith({
    where: { email: { equals: 'a@example.com', mode: 'insensitive' }, status: 'NEW' },
    data: { status: 'CONTACTED' },
  })
})
it('서명 링크는 원문 리드만 허용하고 위조·종료·없는 행은 무효다', async () => {
  const token = signLeadToken('lead-1')
  jest.mocked(prisma.marketingLead.findUnique).mockResolvedValue(lead as never)
  expect(await verifyLeadToken(token)).toEqual(lead)
  expect(await verifyLeadToken(token.replace('lead-1', 'lead-2'))).toBeNull()
  expect(await verifyLeadToken('lead-1.bad')).toBeNull()
  jest
    .mocked(prisma.marketingLead.findUnique)
    .mockResolvedValue({ ...lead, status: 'DROPPED' } as never)
  expect(await verifyLeadToken(token)).toBeNull()
  jest.mocked(prisma.marketingLead.findUnique).mockResolvedValue(null)
  expect(await verifyLeadToken(token)).toBeNull()
})
it('off만 가입 가드를 해제한다', () => {
  expect(isLeadGateEnabled()).toBe(true)
  process.env.SIGNUP_REQUIRES_LEAD = 'off'
  expect(isLeadGateEnabled()).toBe(false)
})

describe('ensureSignupUser', () => {
  const user = { id: 'u1', email: 'a@example.com', name: null }
  const tx = {
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    marketingLead: { findFirst: jest.fn(), updateMany: jest.fn() },
  }
  beforeEach(() => {
    tx.user.findUnique.mockResolvedValue(null)
    tx.marketingLead.findFirst.mockResolvedValue(null)
    tx.user.create.mockResolvedValue({ id: 'u1' })
    tx.user.update.mockResolvedValue({ id: 'u1' })
  })
  it('무리드 신규 가입을 차단하고 초대 callback은 생성을 미룬다', async () => {
    const { ensureSignupUser, SignupNotAllowedError } = await import('../lead-signup')
    await expect(ensureSignupUser(tx as never, user)).rejects.toBeInstanceOf(SignupNotAllowedError)
    expect(await ensureSignupUser(tx as never, user, { deferWithoutLead: true })).toBeNull()
    expect(tx.user.create).not.toHaveBeenCalled()
  })
  it('리드 출처와 전환을 같은 tx에 쓰며 기존 사용자는 우회한다', async () => {
    const { ensureSignupUser } = await import('../lead-signup')
    tx.marketingLead.findFirst.mockResolvedValue(lead)
    await ensureSignupUser(tx as never, user)
    expect(tx.user.create).toHaveBeenCalledWith({
      data: { ...user, signupSource: leadSignupSource(lead) },
      select: { id: true },
    })
    expect(tx.marketingLead.updateMany).toHaveBeenCalled()
    jest.clearAllMocks()
    tx.user.findUnique.mockResolvedValue({ id: 'u1' })
    await ensureSignupUser(tx as never, user)
    expect(tx.marketingLead.findFirst).not.toHaveBeenCalled()
    expect(tx.user.create).not.toHaveBeenCalled()
  })
  it('리드 없는 초대는 invite 출처, off면 일반 가입 출처를 쓴다', async () => {
    const { ensureSignupUser } = await import('../lead-signup')
    await ensureSignupUser(tx as never, user, { invitation: true })
    expect(tx.user.create).toHaveBeenLastCalledWith({
      data: { ...user, signupSource: { utm_source: 'invite' } },
      select: { id: true },
    })
    process.env.SIGNUP_REQUIRES_LEAD = 'off'
    await ensureSignupUser(tx as never, user, { fallbackSource: { utm_source: 'opening' } })
    expect(tx.user.create).toHaveBeenLastCalledWith({
      data: { ...user, signupSource: { utm_source: 'opening' } },
      select: { id: true },
    })
  })
})

it('키 설정이 없으면 서명 링크 검증은 안전하게 무효 처리한다', async () => {
  const token = signLeadToken('lead-1')
  delete process.env.ENCRYPTION_KEY
  expect(await verifyLeadToken(token)).toBeNull()
  expect(prisma.marketingLead.findUnique).not.toHaveBeenCalled()
})
