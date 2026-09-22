/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    adRecord: { groupBy: jest.fn() },
    campaignMeta: { findMany: jest.fn() },
    campaignTarget: { findMany: jest.fn() },
  },
}))

jest.mock('@/lib/coupang-ads/cache', () => {
  const cache = new Map<string, unknown>()
  return {
    cacheCoupangAdsData: async (
      scope: string,
      input: { workspaceId: string },
      loader: () => Promise<unknown>
    ) => {
      const key = `${scope}:${input.workspaceId}`
      if (!cache.has(key)) cache.set(key, await loader())
      return cache.get(key)
    },
    __resetCampaignCatalogCache: () => cache.clear(),
  }
})

import { queryCampaigns } from '@/lib/coupang-ads/queries'

const { prisma } = jest.requireMock('@/lib/prisma') as {
  prisma: {
    $queryRaw: jest.Mock
    adRecord: { groupBy: jest.Mock }
    campaignMeta: { findMany: jest.Mock }
    campaignTarget: { findMany: jest.Mock }
  }
}
const { __resetCampaignCatalogCache } = jest.requireMock('@/lib/coupang-ads/cache') as {
  __resetCampaignCatalogCache: () => void
}

describe('queryCampaigns', () => {
  beforeEach(() => {
    __resetCampaignCatalogCache()
    prisma.$queryRaw.mockReset()
    prisma.adRecord.groupBy.mockReset()
    prisma.$queryRaw.mockResolvedValue([{ campaignId: 'campaign-1', campaignName: '캠페인', adType: 'KEYWORD' }])
    prisma.campaignMeta.findMany.mockReset()
    prisma.campaignTarget.findMany.mockReset()
    prisma.campaignMeta.findMany.mockResolvedValue([])
    prisma.campaignTarget.findMany.mockResolvedValue([])
    prisma.adRecord.groupBy.mockResolvedValue([
      {
        campaignId: 'campaign-1',
        _min: { date: new Date('2026-01-01T00:00:00.000Z') },
        _max: { date: new Date('2026-01-31T00:00:00.000Z') },
      },
    ])
  })

  it('같은 workspace의 반복 조회에서 날짜 범위 집계를 cache miss 때 한 번만 실행한다', async () => {
    await queryCampaigns('workspace-1')
    await queryCampaigns('workspace-1')

    expect(prisma.adRecord.groupBy).toHaveBeenCalledTimes(1)
  })
})
