/** @jest-environment node */
const auth = {
  exchangeCodeForSession: jest.fn(),
  getUser: jest.fn(),
  signOut: jest.fn(),
}
jest.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth }) }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { upsert: jest.fn() },
    workspace: { findUnique: jest.fn() },
    spaceMember: { findFirst: jest.fn() },
  },
}))
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const call = (qs: string) => GET(new NextRequest(`https://app.test/auth/callback?code=c${qs}`))

beforeEach(() => {
  jest.clearAllMocks()
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
