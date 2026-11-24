/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/hooks/use-user'
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
jest.mock('@/lib/prisma', () => {
  const p = {
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn(), create: jest.fn() },
    marketingLead: { findFirst: jest.fn() },
    workspace: { create: jest.fn() },
    $transaction: jest.fn(),
  }
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p))
  return { prisma: p }
})
it('리드 없는 신규 가입의 Workspace 생성은 403이며 User·Workspace를 남기지 않는다', async () => {
  jest
    .mocked(getUser)
    .mockResolvedValue({ id: 'new-user', email: 'new@example.com', user_metadata: {} } as never)
  jest.mocked(prisma.user.findUnique).mockResolvedValue(null)
  jest.mocked(prisma.marketingLead.findFirst).mockResolvedValue(null)
  const res = await POST(
    new NextRequest('http://app.test/api/workspace', {
      method: 'POST',
      body: JSON.stringify({ name: '회사' }),
    })
  )
  expect(res.status).toBe(403)
  expect(await res.json()).toMatchObject({ code: 'SIGNUP_REQUIRES_LEAD' })
  expect(prisma.user.create).not.toHaveBeenCalled()
  expect(prisma.workspace.create).not.toHaveBeenCalled()
})
