/** @jest-environment node */
import WorkspaceSetupPage from '../page'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/hooks/use-user'
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`)
  },
}))
jest.mock('@/components/auth/workspace-setup-form', () => ({ WorkspaceSetupForm: () => null }))
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn() }, marketingLead: { findFirst: jest.fn() } },
}))
beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.SIGNUP_REQUIRES_LEAD
  jest.mocked(getUser).mockResolvedValue({ id: 'new', email: 'new@example.com' } as never)
  jest.mocked(prisma.user.findUnique).mockResolvedValue(null)
  jest.mocked(prisma.marketingLead.findFirst).mockResolvedValue(null)
})
afterEach(() => {
  delete process.env.SIGNUP_REQUIRES_LEAD
})
const page = () => WorkspaceSetupPage({ searchParams: Promise.resolve({}) })
it('인증만 있는 무리드 세션을 가입 안내로 보낸다', async () => {
  await expect(page()).rejects.toThrow('REDIRECT:/signup?blocked=lead')
})
it('기존 User·문의 이메일·off는 설정을 계속한다', async () => {
  jest.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'new' } as never)
  await expect(page()).resolves.toBeTruthy()
  expect(prisma.marketingLead.findFirst).not.toHaveBeenCalled()
  jest.mocked(prisma.marketingLead.findFirst).mockResolvedValueOnce({ id: 'lead' } as never)
  await expect(page()).resolves.toBeTruthy()
  process.env.SIGNUP_REQUIRES_LEAD = 'off'
  await expect(page()).resolves.toBeTruthy()
})
