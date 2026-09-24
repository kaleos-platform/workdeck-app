/** @jest-environment node */

const entries = new Map<string, unknown>()
const entryTags = new Map<string, string[]>()
jest.mock('next/cache', () => ({
  unstable_cache:
    (loader: () => Promise<unknown>, key: string[], options: { tags: string[] }) => async () => {
      const id = JSON.stringify(key)
      if (!entries.has(id)) {
        entries.set(id, JSON.parse(JSON.stringify(await loader())))
        entryTags.set(id, options.tags)
      }
      return entries.get(id)
    },
  revalidateTag: (tag: string) => {
    for (const [key, tags] of entryTags) if (tags.includes(tag)) entries.delete(key)
  },
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    adRecord: { groupBy: jest.fn(), aggregate: jest.fn() },
    campaignMeta: { findMany: jest.fn() },
    campaignTarget: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { queryCampaigns, queryCampaignNavigation, queryKpi } from '@/lib/coupang-ads/queries'
import { invalidateCoupangAdsCache } from '@/lib/coupang-ads/cache'

const period = { startDate: '2026-09-06', endDate: '2026-09-12' }

beforeEach(() => {
  entries.clear()
  entryTags.clear()
  jest.clearAllMocks()
  jest
    .mocked(prisma.$queryRaw)
    .mockImplementation((async (query: TemplateStringsArray) =>
      query.join('').includes('AS "minDate"')
        ? [{ campaignId: 'c1', minDate: new Date('2026-09-01'), maxDate: new Date('2026-09-12') }]
        : [{ campaignId: 'c1', campaignName: '원본', adType: '매출 최적화' }]) as never)
  jest.mocked(prisma.campaignMeta.findMany).mockResolvedValue([])
  jest.mocked(prisma.campaignTarget.findMany).mockResolvedValue([])
  jest.mocked(prisma.adRecord.groupBy).mockImplementation((async (args: { by: string[] }) => {
    if (args.by.includes('date'))
      return [
        { campaignId: 'c1', date: new Date('2026-09-06'), _sum: { adCost: 100, revenue1d: 200 } },
      ] as never
    return [{ campaignId: 'c1', _sum: { adCost: 100, revenue1d: 200 } }] as never
  }) as never)
  jest.mocked(prisma.adRecord.aggregate).mockResolvedValue({
    _sum: { adCost: 100, revenue1d: 200, orders1d: 2, clicks: 10, impressions: 100 },
  } as never)
})

test('같은 기간 재진입은 목록 집계를 재실행하지 않고 숫자와 날짜를 보존한다', async () => {
  const first = await queryCampaigns('w1', period)
  const calls = jest.mocked(prisma.adRecord.groupBy).mock.calls.length
  expect(first[0]).toMatchObject({
    minDate: '2026-09-01',
    maxDate: '2026-09-12',
    metrics: { totalAdCost: 100, avgRoas: 200 },
  })
  expect(await queryCampaigns('w1', period)).toEqual(first)
  expect(prisma.adRecord.groupBy).toHaveBeenCalledTimes(calls)
})

test('workspace·기간별 집계 결과를 분리하고 변경 후 다시 조회한다', async () => {
  await queryCampaigns('w1', period)
  const before = jest.mocked(prisma.adRecord.groupBy).mock.calls.length
  await queryCampaigns('w2', period)
  await queryCampaigns('w1', { ...period, startDate: '2026-09-05' })
  expect(jest.mocked(prisma.adRecord.groupBy).mock.calls.length).toBeGreaterThan(before)
  invalidateCoupangAdsCache('w1')
  jest
    .mocked(prisma.$queryRaw)
    .mockResolvedValueOnce([{ campaignId: 'c1', campaignName: '수정됨', adType: '매출 최적화' }])
  expect((await queryCampaigns('w1', period))[0].name).toBe('수정됨')
})

test('같은 기간 KPI는 재집계하지 않으며 변경 후 최신 값을 반환한다', async () => {
  expect((await queryKpi('w1', period)).adCost).toBe(100)
  await queryKpi('w1', period)
  expect(prisma.adRecord.aggregate).toHaveBeenCalledTimes(2)
  invalidateCoupangAdsCache('w1')
  jest.mocked(prisma.adRecord.aggregate).mockResolvedValue({ _sum: { adCost: 300 } } as never)
  expect((await queryKpi('w1', period)).adCost).toBe(300)
})

test('사이드바 목록은 날짜·성과를 집계하지 않고 캠페인 식별 정보만 반환한다', async () => {
  expect(await queryCampaignNavigation('w1')).toEqual([
    { id: 'c1', name: '원본', displayName: '원본', isCustomName: false, adTypes: ['매출 최적화'] },
  ])
  expect(prisma.adRecord.groupBy).not.toHaveBeenCalled()
  expect(prisma.adRecord.aggregate).not.toHaveBeenCalled()
})

test('기간별 목록에 목표 요약을 포함해 캠페인별 추가 요청이 필요 없다', async () => {
  const campaigns = await queryCampaigns('w1', period)
  expect(campaigns[0]).toHaveProperty('summary', { budgetUtilization: null, roasAchievement: null })
})

test('목표 요약 실패 시 성과 목록은 유지하고 다음 조회에서 요약을 재시도한다', async () => {
  jest
    .mocked(prisma.campaignTarget.findMany)
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error('summary query failed'))
  const campaigns = await queryCampaigns('w1', period)
  expect(campaigns[0]).toMatchObject({
    metrics: { totalAdCost: 100 },
    summary: { budgetUtilization: null, roasAchievement: null },
  })
  await queryCampaigns('w1', period)
  expect(prisma.campaignTarget.findMany).toHaveBeenCalledTimes(3)
})

test('기간이 달라도 전체 날짜 범위는 재사용하고 다른 workspace 무효화의 영향을 받지 않는다', async () => {
  await queryCampaigns('w1', period)
  await queryCampaigns('w1', { ...period, startDate: '2026-09-05' })
  expect(
    jest
      .mocked(prisma.$queryRaw)
      .mock.calls.filter(([query]) => String(query).includes('AS "minDate"'))
  ).toHaveLength(1)
  await queryCampaigns('w2', period)
  invalidateCoupangAdsCache('w1')
  const count = jest.mocked(prisma.adRecord.groupBy).mock.calls.length
  const rawCount = jest.mocked(prisma.$queryRaw).mock.calls.length
  await queryCampaigns('w2', period)
  expect(prisma.adRecord.groupBy).toHaveBeenCalledTimes(count)
  expect(prisma.$queryRaw).toHaveBeenCalledTimes(rawCount)
})

test('무효화와 겹친 옛 목록의 날짜 cache가 새 캠페인 날짜를 가리지 않는다', async () => {
  await queryCampaigns('w1')
  // 업로드 무효화 직후 진행 중이던 옛 목록 요청이 날짜 cache만 다시 채운 상태를 재현한다.
  for (const key of entries.keys()) {
    if (key.includes('campaign-catalog-')) entries.delete(key)
  }
  jest.mocked(prisma.$queryRaw).mockImplementation((async (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    if (query.join('').includes('AS "minDate"')) {
      return (values[2] as string[]).map((campaignId) => ({
        campaignId,
        minDate: new Date('2026-09-01'),
        maxDate: new Date('2026-09-12'),
      }))
    }
    return ['c1', 'c2'].map((campaignId) => ({
      campaignId,
      campaignName: campaignId,
      adType: '매출 최적화',
    }))
  }) as never)
  const campaigns = await queryCampaigns('w1')
  expect(campaigns.find((campaign) => campaign.id === 'c2')).toMatchObject({
    minDate: '2026-09-01',
    maxDate: '2026-09-12',
  })
})
