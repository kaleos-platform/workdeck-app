/** @jest-environment node */
jest.mock('@/lib/api-helpers', () => ({ resolveWorkspace: jest.fn() }))
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    workspace: { findUnique: jest.fn() },
    adRecord: { findFirst: jest.fn() },
    spaceMember: { findFirst: jest.fn() },
  },
}))
jest.mock('@/lib/coupang-ads/queries', () => ({ queryKpi: jest.fn(), queryCampaigns: jest.fn() }))
jest.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
jest.mock('@/components/dashboard/dashboard-client', () => ({ DashboardClient: () => null }))
import { resolveWorkspace } from '@/lib/api-helpers'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { queryKpi, queryCampaigns } from '@/lib/coupang-ads/queries'
import HomePage from '../page'

beforeEach(() => jest.clearAllMocks())
test.each([
  [401, '/login'],
  [403, '/my-deck'],
  [404, '/workspace-setup'],
])('권한 오류 %s이면 초기 광고 데이터를 조회하지 않는다', async (status, path) => {
  jest.mocked(resolveWorkspace).mockResolvedValue({ error: { status } } as never)
  await expect(HomePage()).rejects.toThrow(`redirect:${path}`)
  expect(queryKpi).not.toHaveBeenCalled()
  expect(queryCampaigns).not.toHaveBeenCalled()
})

it('Workspace 없이 Space 구성원이면 /workspace-setup 대신 /my-deck', async () => {
  jest.mocked(resolveWorkspace).mockResolvedValue({ error: { status: 404 } } as never)
  jest.mocked(getUser).mockResolvedValue({ id: 'u' } as never)
  jest.mocked(prisma.spaceMember.findFirst).mockResolvedValue({ id: 'm' } as never)
  await expect(HomePage()).rejects.toThrow('redirect:/my-deck')
  expect(prisma.spaceMember.findFirst).toHaveBeenCalledWith({
    where: { userId: 'u' },
    select: { id: true },
  })
})
