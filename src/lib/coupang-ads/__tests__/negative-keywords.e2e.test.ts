/**
 * 제외 키워드 후보 집계(raw SQL) + 쓰기 API e2e — throwaway workspace, dev DB.
 * AdRecord.date 는 KST 자정 시각(UTC 전날 15:00)으로 저장 — 실제 적재 형식 그대로 시드한다.
 * DB URL 없으면 전체 skip. 실행: npx jest -c jest.config.e2e.ts src/lib/coupang-ads/__tests__/negative-keywords.e2e.test.ts
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'

jest.mock('@/lib/api-helpers', () => ({
  ...jest.requireActual('@/lib/api-helpers'),
  resolveWorkspace: jest.fn(),
}))
jest.mock('@/lib/coupang-ads/cache', () => ({ invalidateCoupangAdsCache: jest.fn() }))

import { resolveWorkspace } from '@/lib/api-helpers'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/coupang-ads/negative-keywords/route'
import { DELETE } from '@/app/api/campaigns/[campaignId]/keyword-status/route'
import { getNegativeKeywordCandidates } from '@/lib/coupang-ads/negative-keyword-candidates'

const WS_ID = 'e2e00000-0000-4000-8000-00000000nk01'
const OTHER_WS_ID = 'e2e00000-0000-4000-8000-00000000nk02'
const USER_ID = 'e2e00000-0000-4000-8000-00000000nk03'
const OTHER_USER_ID = 'e2e00000-0000-4000-8000-00000000nk04'
const CAMP = 'e2e-negkw-camp'
const OTHER_CAMP = 'e2e-negkw-other'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

// 오늘 = 2026-11-25 KST → 집계 구간 [10-26, 11-24], 90일 시작 08-27
const NOW = new Date('2026-11-25T03:00:00Z')
const kst = (day: string) => new Date(`${day}T00:00:00+09:00`)

let reportId = ''
async function ad(
  keyword: string,
  day: string,
  over: {
    adCost?: number
    clicks?: number
    orders1d?: number
    orders14d?: number | null
    adGroup?: string
  } = {}
) {
  await prisma.adRecord.create({
    data: {
      workspaceId: WS_ID,
      reportId,
      date: kst(day),
      adType: '키워드 광고',
      campaignId: CAMP,
      campaignName: 'E2E 제외키워드',
      adGroup: over.adGroup ?? 'g1',
      keyword,
      impressions: 100,
      clicks: over.clicks ?? 10,
      adCost: over.adCost ?? 10_000,
      ctr: 0,
      orders1d: over.orders1d ?? 0,
      orders14d: over.orders14d === undefined ? 0 : over.orders14d,
      revenue1d: 0,
      roas1d: 0,
    },
  })
}

async function cleanup() {
  await prisma.workspace.deleteMany({ where: { id: { in: [WS_ID, OTHER_WS_ID] } } })
  await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } })
}

async function post(body: unknown): Promise<Response> {
  return (await POST(
    new NextRequest('http://localhost/api/coupang-ads/negative-keywords', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  ))!
}

d('제외 키워드 e2e', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-negkw@throwaway.test' } })
    await prisma.user.create({ data: { id: OTHER_USER_ID, email: 'e2e-negkw2@throwaway.test' } })
    await prisma.workspace.create({ data: { id: WS_ID, ownerId: USER_ID, name: 'E2E NegKw' } })
    await prisma.workspace.create({
      data: { id: OTHER_WS_ID, ownerId: OTHER_USER_ID, name: 'E2E NegKw2' },
    })
    const up = await prisma.reportUpload.create({
      data: {
        fileName: 'negkw.xlsx',
        periodStart: kst('2026-08-01'),
        periodEnd: kst('2026-11-25'),
        workspaceId: WS_ID,
      },
    })
    reportId = up.id
    ;(resolveWorkspace as jest.Mock).mockResolvedValue({ workspace: { id: WS_ID } })

    // 구간 첫날·마지막 날 + 광고그룹 분할 합산 → 후보, 마지막 지출일 11-24
    await ad('cand', '2026-10-26', { adCost: 6_000, clicks: 6 })
    await ad('cand', '2026-11-24', { adCost: 4_000, clicks: 4, adGroup: 'g2' })
    // 오늘 행만 있음 → 제외
    await ad('today-only', '2026-11-25', { adCost: 50_000, clicks: 50 })
    // 30일 바로 전날(10-25) 지출만 → 후보 아님
    await ad('before30', '2026-10-25', { adCost: 50_000, clicks: 50 })
    // 90일 첫날(08-27) 주문 → 보호 / 그 전날(08-26) 주문 → 후보
    await ad('prot', '2026-11-01')
    await ad('prot', '2026-08-27', { adCost: 1_000, clicks: 1, orders14d: 1 })
    await ad('prot-out', '2026-11-01')
    await ad('prot-out', '2026-08-26', { adCost: 1_000, clicks: 1, orders14d: 1 })
    // orders14d null → orders1d 폴백(주문 1) → 후보 아님
    await ad('fallback', '2026-11-01', { orders14d: null, orders1d: 1 })

    // 제거 후 지출: 제거 시각 KST 11-10 23:59 / 11-11 00:01
    const late = new Date('2026-11-10T14:59:00Z')
    const early = new Date('2026-11-10T15:01:00Z')
    await prisma.keywordStatus.createMany({
      data: [
        { workspaceId: WS_ID, campaignId: CAMP, keyword: 'rm-a', removedAt: late },
        { workspaceId: WS_ID, campaignId: CAMP, keyword: 'rm-b', removedAt: late },
        { workspaceId: WS_ID, campaignId: CAMP, keyword: 'rm-c', removedAt: early },
      ],
    })
    await ad('rm-a', '2026-11-12', { adCost: 3_000 }) // 제거일+2 → 유예
    await ad('rm-b', '2026-11-13', { adCost: 3_000 }) // 제거일+3 → 경고
    await ad('rm-c', '2026-11-13', { adCost: 3_000 }) // 제거일(11-11)+2 → 유예
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('후보·보호·구간 경계', async () => {
    const res = await getNegativeKeywordCandidates(WS_ID, NOW)
    expect(res.period).toEqual({ start: '2026-10-26', end: '2026-11-24' })
    const c = res.campaigns.find((x) => x.campaignId === CAMP)!
    expect(c.campaignName).toBe('E2E 제외키워드')
    expect(c.removedCount).toBe(3)
    expect(c.candidates.map((k) => k.keyword).sort()).toEqual(['cand', 'prot-out'])
    expect(c.candidates.find((k) => k.keyword === 'cand')).toEqual({
      keyword: 'cand',
      adCost30: 10_000,
      clicks30: 10,
      orders30: 0,
      lastSpendDate: '2026-11-24',
    })
    expect(c.protected.map((k) => k.keyword)).toEqual(['prot'])
    expect(c.protected[0].orders90).toBe(1)
  })

  it('제거했는데 지출 중: 제거일 KST + 3일부터만 경고', async () => {
    const res = await getNegativeKeywordCandidates(WS_ID, NOW)
    expect(res.spendingAfterRemoval.map((s) => s.keyword)).toEqual(['rm-b'])
    expect(res.spendingAfterRemoval[0]).toMatchObject({
      lastSpendDate: '2026-11-13',
      lastSpendAmount: 3_000,
    })
  })

  it('검증 400·다른 공간 캠페인 404', async () => {
    const base = { action: 'remove', campaignId: CAMP }
    expect((await post({ ...base, keywords: [] })).status).toBe(400)
    expect(
      (await post({ ...base, keywords: Array.from({ length: 1001 }, (_, i) => `k${i}`) })).status
    ).toBe(400)
    expect((await post({ ...base, keywords: ['a', 1] })).status).toBe(400)
    expect((await post({ ...base, action: 'nope', keywords: ['a'] })).status).toBe(400)
    expect((await post({ ...base, campaignId: OTHER_CAMP, keywords: ['a'] })).status).toBe(404)
  })

  it('remove 재시도는 최초 removedAt 유지, undo 는 같은 removedAt 행만 해제', async () => {
    const r1 = await (
      await post({ action: 'remove', campaignId: CAMP, keywords: ['cand', 'prot-out'] })
    ).json()
    const first = await prisma.keywordStatus.findMany({
      where: { workspaceId: WS_ID, keyword: { in: ['cand', 'prot-out'] } },
    })
    expect(first.every((s) => s.removedAt?.toISOString() === r1.removedAt)).toBe(true)

    await new Promise((r) => setTimeout(r, 10))
    await post({ action: 'remove', campaignId: CAMP, keywords: ['cand'] })
    const again = await prisma.keywordStatus.findFirst({
      where: { workspaceId: WS_ID, keyword: 'cand' },
    })
    expect(again!.removedAt!.toISOString()).toBe(r1.removedAt)

    // 다른 사람이 prot-out 을 해제 후 다시 제거(다른 시각) → undo 가 건드리지 않음
    await prisma.keywordStatus.updateMany({
      where: { workspaceId: WS_ID, keyword: 'prot-out' },
      data: { removedAt: new Date('2026-11-25T05:00:00Z') },
    })
    const undo = await (
      await post({
        action: 'undo',
        campaignId: CAMP,
        keywords: ['cand', 'prot-out'],
        removedAt: r1.removedAt,
      })
    ).json()
    expect(undo.count).toBe(1)
    const after = await prisma.keywordStatus.findMany({
      where: { workspaceId: WS_ID, keyword: { in: ['cand', 'prot-out'] } },
      orderBy: { keyword: 'asc' },
    })
    expect(after.map((s) => [s.keyword, s.removedAt === null])).toEqual([
      ['cand', true],
      ['prot-out', false],
    ])
  })

  it('dismiss 는 후보에서 숨기고, 기존 DELETE(제거 취소)는 dismissedUntil 을 보존', async () => {
    await post({ action: 'remove', campaignId: CAMP, keywords: ['cand'] })
    await post({ action: 'dismiss', campaignId: CAMP, keywords: ['cand'] })
    const res = await DELETE(
      new NextRequest(`http://localhost/api/campaigns/${CAMP}/keyword-status?keywords=cand`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ campaignId: CAMP }) }
    )
    expect(res!.status).toBe(200)
    const s = await prisma.keywordStatus.findFirst({
      where: { workspaceId: WS_ID, keyword: 'cand' },
    })
    expect(s!.removedAt).toBeNull()
    expect(s!.dismissedUntil).not.toBeNull()
    const list = await getNegativeKeywordCandidates(WS_ID, new Date())
    expect(list.campaigns.flatMap((c) => c.candidates.map((k) => k.keyword))).not.toContain('cand')

    await post({ action: 'undismiss', campaignId: CAMP, keywords: ['cand'] })
    const s2 = await prisma.keywordStatus.findFirst({
      where: { workspaceId: WS_ID, keyword: 'cand' },
    })
    expect(s2!.dismissedUntil).toBeNull()
  })
})
