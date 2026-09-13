/** @jest-environment node */

jest.mock('server-only', () => ({}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    campaignTarget: { findMany: jest.fn() },
    adRecord: { groupBy: jest.fn() },
  },
}))
jest.mock('../cache', () => ({
  cacheCoupangAdsData: jest.fn((_namespace, _input, loader) => loader()),
}))

import { prisma } from '@/lib/prisma'
import { cacheCoupangAdsData } from '../cache'
import { queryCampaignTargetSummaries, queryCampaignTargetSummary } from '../target-summary'

beforeEach(() => jest.clearAllMocks())

const target = (campaignId: string, date: string, dailyBudget: number, targetRoas: number) => ({
  campaignId,
  effectiveDate: new Date(date),
  dailyBudget,
  targetRoas,
})
const daily = (campaignId: string, date: string, adCost: number, revenue1d: number) => ({
  campaignId,
  date: new Date(date),
  _sum: { adCost, revenue1d },
})

test('기존 KST 경계 날짜와 목표 변경 carry-forward를 보존하고 캠페인을 분리한다', async () => {
  jest
    .mocked(prisma.campaignTarget.findMany)
    .mockResolvedValue([
      target('a', '2026-05-01', 100, 200),
      target('a', '2026-05-02', 200, 400),
      target('b', '2026-05-01', 1000, 1000),
    ] as never)
  jest
    .mocked(prisma.adRecord.groupBy)
    .mockResolvedValue([
      daily('a', '2026-05-01', 30, 90),
      daily('a', '2026-05-02', 60, 180),
      daily('a', '2026-05-03', 999, 999),
    ] as never)
  const result = await queryCampaignTargetSummaries('workspace', '2026-05-02', '2026-05-03')
  // 기존 구현은 5/2~5/3 KST 요청에서 UTC 날짜 5/1, 5/2를 순회한다.
  expect(result).toEqual({
    a: { budgetUtilization: 30, roasAchievement: 100 },
    b: { budgetUtilization: 0, roasAchievement: 0 },
  })
  expect(prisma.campaignTarget.findMany).toHaveBeenCalledTimes(1)
  expect(prisma.adRecord.groupBy).toHaveBeenCalledTimes(1)
  expect(prisma.adRecord.groupBy).toHaveBeenCalledWith(
    expect.objectContaining({
      by: ['campaignId', 'date'],
      where: {
        workspaceId: 'workspace',
        date: {
          gte: new Date('2026-05-02T00:00:00+09:00'),
          lte: new Date('2026-05-03T23:59:59+09:00'),
        },
      },
    })
  )
  expect(cacheCoupangAdsData).toHaveBeenCalledWith(
    'target-summaries',
    { workspaceId: 'workspace', from: '2026-05-02', to: '2026-05-03' },
    expect.any(Function)
  )
})

test('목표가 없으면 null을 반환하고 단건 쿼리에 campaignId를 적용한다', async () => {
  jest.mocked(prisma.campaignTarget.findMany).mockResolvedValue([])
  jest.mocked(prisma.adRecord.groupBy).mockResolvedValue([])
  expect(await queryCampaignTargetSummary('workspace', 'a', '2026-05-02', '2026-05-03')).toEqual({
    budgetUtilization: null,
    roasAchievement: null,
  })
  for (const query of [prisma.campaignTarget.findMany, prisma.adRecord.groupBy]) {
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'workspace', campaignId: 'a' }),
      })
    )
  }
})
