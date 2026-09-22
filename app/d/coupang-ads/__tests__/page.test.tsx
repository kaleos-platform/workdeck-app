/** @jest-environment node */
jest.mock('@/lib/api-helpers', () => ({ resolveWorkspace: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: { workspace: { findUnique: jest.fn() }, adRecord: { findFirst: jest.fn() } },
}))
jest.mock('@/lib/coupang-ads/queries', () => ({ queryKpi: jest.fn(), queryCampaigns: jest.fn() }))
jest.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
jest.mock('@/components/dashboard/dashboard-client', () => ({ DashboardClient: () => null }))
import { resolveWorkspace } from '@/lib/api-helpers'
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
