/** @jest-environment node */
const auth = {
  exchangeCodeForSession: jest.fn(),
  getUser: jest.fn(),
  signOut: jest.fn(),
}
jest.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth }) }))
jest.mock('@/lib/prisma', () => {
  const p = {
    user: { upsert: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    workspace: { findUnique: jest.fn() },
    spaceMember: { findFirst: jest.fn() },
    marketingLead: { findFirst: jest.fn(), updateMany: jest.fn() },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  }
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p))
  return { prisma: p }
})
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const call = (qs: string) => GET(new NextRequest(`https://app.test/auth/callback?code=c${qs}`))

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.SIGNUP_REQUIRES_LEAD
  jest.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u' } as never)
  jest.mocked(prisma.marketingLead.findFirst).mockResolvedValue(null)
  auth.exchangeCodeForSession.mockResolvedValue({ error: null })
  auth.getUser.mockResolvedValue({
    data: { user: { id: 'u', email: 'invitee@example.com', user_metadata: {} } },
  })
  jest.mocked(prisma.workspace.findUnique).mockResolvedValue(null)
})

it('Workspace 없이 Space 구성원이면 /workspace-setup 대신 요청 목적지로', async () => {
  jest.mocked(prisma.spaceMember.findFirst).mockResolvedValue({ id: 'm' } as never)
  expect((await call('&next=%2Fapprovals')).headers.get('location')).toBe(
    'https://app.test/approvals'
  )
  expect((await call('')).headers.get('location')).toBe('https://app.test/my-deck')
})

it('Workspace도 구성원도 없으면 기존처럼 /workspace-setup', async () => {
  jest.mocked(prisma.spaceMember.findFirst).mockResolvedValue(null)
  expect((await call('')).headers.get('location')).toBe('https://app.test/workspace-setup')
})

it('Workspace도 구성원도 없어도 초대 수락 경로(next=/invite/…)면 그 경로로', async () => {
  jest.mocked(prisma.spaceMember.findFirst).mockResolvedValue(null)
  expect((await call('&next=%2Finvite%2Ftok123')).headers.get('location')).toBe(
    'https://app.test/invite/tok123'
  )
})

it('리드 없는 신규 Google 계정은 로그아웃하고 blocked 안내로 보낸다', async () => {
  jest.mocked(prisma.user.findUnique).mockResolvedValue(null)
  expect((await call('')).headers.get('location')).toBe('https://app.test/signup?blocked=lead')
  expect(auth.signOut).toHaveBeenCalled()
  expect(prisma.user.create).not.toHaveBeenCalled()
})
it('리드 없는 초대 신규 계정은 Prisma User 생성 없이 수락 화면으로 보낸다', async () => {
  jest.mocked(prisma.user.findUnique).mockResolvedValue(null)
  expect((await call('&next=%2Finvite%2Ftok123')).headers.get('location')).toBe(
    'https://app.test/invite/tok123'
  )
  expect(prisma.user.create).not.toHaveBeenCalled()
  expect(auth.signOut).not.toHaveBeenCalled()
})
it('신규 리드는 출처와 전환을 같은 tx에 기록한다', async () => {
  jest.mocked(prisma.user.findUnique).mockResolvedValue(null)
  jest.mocked(prisma.marketingLead.findFirst).mockResolvedValue({
    utm: { utm_source: 'notice' },
    referrer: null,
    createdAt: new Date('2026-01-01'),
  } as never)
  await call('')
  expect(prisma.user.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        signupSource: expect.objectContaining({ utm_source: 'notice', landing: 'lead' }),
      }),
    })
  )
  expect(prisma.marketingLead.updateMany).toHaveBeenCalled()
})
it('off면 리드 없는 신규 Google 계정도 생성한다', async () => {
  process.env.SIGNUP_REQUIRES_LEAD = 'off'
  jest.mocked(prisma.user.findUnique).mockResolvedValue(null)
  await call('')
  expect(prisma.user.create).toHaveBeenCalled()
  expect(auth.signOut).not.toHaveBeenCalled()
  delete process.env.SIGNUP_REQUIRES_LEAD
})
