/**
 * seller-hub.keywords.update 승인 액션 + 주간 키워드 리뷰 e2e — 실 dev DB, 전용 Space 픽스처.
 */
import { prisma } from '@/lib/prisma'
import { loadKeywordReview } from '@/lib/sh/keyword-review-query'
import { createPendingAction } from '../create'
import { approveAndExecute, rejectAction } from '../execute'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000f1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000f2'
const OTHER_SPACE_ID = 'e2e00000-0000-4000-8000-0000000000f3'
const TYPE = 'seller-hub.keywords.update'

const kws = (n: number) => Array.from({ length: n }, (_, i) => `키${i}`)

d('seller-hub.keywords.update', () => {
  let cpId: string
  let cp2Id: string
  let groupedListingId: string
  let soloListingId: string
  let channelId: string
  let workspaceId: string

  const propose = (params: Record<string, unknown>) =>
    createPendingAction({
      spaceId: SPACE_ID,
      actionType: TYPE,
      params,
      summary: 'e2e 키워드',
      source: 'MCP',
      actor: { type: 'agent', id: 'ag-e2e' },
    })

  async function cleanup() {
    await prisma.keywordChangeLog.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.agentPendingAction.deleteMany({
      where: { spaceId: { in: [SPACE_ID, OTHER_SPACE_ID] } },
    })
    await prisma.workspace.deleteMany({ where: { ownerId: USER_ID } }) // AdRecord/ReportUpload cascade
    await prisma.spaceMember.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: { in: [SPACE_ID, OTHER_SPACE_ID] } } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
  }

  beforeAll(async () => {
    await cleanup()
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-keyword@throwaway.test', name: 'E2E Keyword' },
    })
    await prisma.space.create({ data: { id: SPACE_ID, name: 'E2E Keyword', type: 'PERSONAL' } })
    await prisma.space.create({
      data: { id: OTHER_SPACE_ID, name: 'E2E Keyword 2', type: 'PERSONAL' },
    })
    await prisma.spaceMember.create({
      data: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' },
    })
    const ch = await prisma.channel.create({ data: { spaceId: SPACE_ID, name: 'E2E 채널' } })
    channelId = ch.id
    const cp = await prisma.channelProduct.create({
      data: {
        spaceId: SPACE_ID,
        channelId,
        baseSearchName: 'E2E CP',
        keywords: ['기존', '삭제대상'],
      },
    })
    cpId = cp.id
    const cp2 = await prisma.channelProduct.create({
      data: { spaceId: SPACE_ID, channelId, baseSearchName: 'E2E CP2', keywords: kws(28) },
    })
    cp2Id = cp2.id
    const gl = await prisma.productListing.create({
      data: {
        spaceId: SPACE_ID,
        channelId,
        channelProductId: cpId,
        searchName: 'E2E 그룹 리스팅',
        displayName: 'E2E 그룹 리스팅',
      },
    })
    groupedListingId = gl.id
    const sl = await prisma.productListing.create({
      data: {
        spaceId: SPACE_ID,
        channelId,
        searchName: 'E2E 단독',
        displayName: 'E2E 단독',
        keywords: ['등록어', '무노출어'],
      },
    })
    soloListingId = sl.id

    // 광고 픽스처: 같은 sellerProductId 에 연결 아이템 1 + 미연결 아이템 1.
    const ws = await prisma.workspace.create({
      data: { name: 'E2E WS', ownerId: USER_ID, spaceId: SPACE_ID },
    })
    workspaceId = ws.id
    await prisma.coupangProductItem.createMany({
      data: [
        {
          spaceId: SPACE_ID,
          sellerProductId: 'SP-E2E',
          rgVendorItemId: 'RG-LINKED',
          listingId: soloListingId,
          collectedAt: new Date(),
        },
        {
          spaceId: SPACE_ID,
          sellerProductId: 'SP-E2E',
          rgVendorItemId: 'RG-UNLINKED',
          collectedAt: new Date(),
        },
      ],
    })
    const report = await prisma.reportUpload.create({
      data: { fileName: 'e2e', periodStart: new Date(), periodEnd: new Date(), workspaceId },
    })
    const date = new Date('2026-10-20T00:00:00+09:00')
    const base = {
      date,
      adType: 'KW',
      campaignId: 'c1',
      campaignName: 'c1',
      adGroup: 'g',
      adCost: 100,
      ctr: 0,
      revenue1d: 0,
      roas1d: 0,
      workspaceId,
      reportId: report.id,
    }
    await prisma.adRecord.createMany({
      data: [
        {
          ...base,
          optionId: 'RG-LINKED',
          keyword: '등록어',
          impressions: 600,
          clicks: 5,
          orders1d: 2,
        },
        {
          ...base,
          optionId: 'RG-UNLINKED',
          keyword: '냉감 신상',
          impressions: 600,
          clicks: 10,
          orders1d: 3,
        },
      ],
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('제안 생성: beforeState·summary, 중복 PENDING 거부, 그룹 리스팅·타 Space 거부', async () => {
    const r = await propose({
      target: { channelProductId: cpId },
      add: ['신규'],
      remove: ['삭제대상'],
    })
    expect(r.status).toBe('pending_approval')
    const row = await prisma.agentPendingAction.findUniqueOrThrow({ where: { id: r.actionId } })
    expect(row.beforeState).toMatchObject({ name: 'E2E CP', keywordCount: 2 })
    expect(row.summary).toBe('e2e 키워드')

    await expect(
      propose({ target: { channelProductId: cpId }, add: ['또'], remove: [] })
    ).rejects.toThrow(/승인 대기 중/)
    await expect(
      propose({ target: { listingId: groupedListingId }, add: ['x'], remove: [] })
    ).rejects.toThrow(/channelProductId/)
    await expect(
      createPendingAction({
        spaceId: OTHER_SPACE_ID,
        actionType: TYPE,
        params: { target: { channelProductId: cpId }, add: ['x'], remove: [] },
        summary: 's',
        source: 'MCP',
        actor: { type: 'agent', id: 'ag-e2e' },
      })
    ).rejects.toThrow(/찾을 수 없습니다/)
    // 타 Space 의 PENDING 은 중복 판정에 영향 없음(위 거부는 스코프 때문)
    expect(await prisma.agentPendingAction.count({ where: { spaceId: OTHER_SPACE_ID } })).toBe(0)
  })

  test('승인 실행: CP 키워드 갱신 + KeywordChangeLog(channelProductId·actor·reason null)', async () => {
    const pending = await prisma.agentPendingAction.findFirstOrThrow({
      where: { spaceId: SPACE_ID, status: 'PENDING' },
    })
    const out = await approveAndExecute(pending.id, USER_ID)
    expect(out.status).toBe('EXECUTED')
    const cp = await prisma.channelProduct.findUniqueOrThrow({ where: { id: cpId } })
    expect(cp.keywords).toEqual(['기존', '신규'])
    const logs = await prisma.keywordChangeLog.findMany({ where: { spaceId: SPACE_ID } })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      channelProductId: cpId,
      listingId: null,
      beforeName: 'E2E CP',
      afterName: 'E2E CP',
      reason: null,
      multiChange: false,
      actorUserId: USER_ID,
    })
    expect(logs[0].beforeKeywords).toEqual(['기존', '삭제대상'])
    expect(logs[0].afterKeywords).toEqual(['기존', '신규'])
    // 승인 후에는 같은 대상에 새 제안 가능
    const again = await propose({ target: { channelProductId: cpId }, add: ['세번째'], remove: [] })
    await rejectAction(again.actionId, USER_ID)
  })

  test('리뷰: 미연결 아이템 광고 합계 포함, 노출 충분 시 prune, 대기 제안 id', async () => {
    const pend = await propose({
      target: { listingId: soloListingId },
      add: ['냉감'],
      remove: ['무노출어'],
    })
    const rv = await loadKeywordReview(SPACE_ID)
    const t = rv.targets.find((x) => x.target.id === soloListingId)
    expect(t).toBeDefined()
    expect(t!.ad).toMatchObject({ impressions: 1200, orders: 5 })
    expect(t!.prune).toEqual(['무노출어'])
    expect(t!.discover.map((w) => w.word)).toContain('냉감')
    expect(t!.pendingProposal).toBe(pend.actionId)

    // 거절 → 제안 단어가 발굴·정리에서 억제된다
    await rejectAction(pend.actionId, USER_ID)
    const rv2 = await loadKeywordReview(SPACE_ID)
    const t2 = rv2.targets.find((x) => x.target.id === soloListingId)!
    expect(t2.pendingProposal).toBeNull()
    expect(t2.discover.map((w) => w.word)).not.toContain('냉감')
    expect(t2.prune).not.toContain('무노출어')
    expect(t2.suppressed).toEqual(expect.arrayContaining(['냉감', '무노출어']))

    // 타 Space 조회에는 이 데이터가 없다
    expect((await loadKeywordReview(OTHER_SPACE_ID)).targets).toEqual([])
  })

  test('실행 시점 30개 초과 → FAILED, 쓰기 없음', async () => {
    const r = await propose({
      target: { channelProductId: cp2Id },
      add: ['추가1', '추가2'],
      remove: [],
    })
    // 제안 후 사람이 키워드를 하나 더 넣어 승인 시점엔 한도를 넘게 된다
    await prisma.channelProduct.update({ where: { id: cp2Id }, data: { keywords: kws(29) } })
    const out = await approveAndExecute(r.actionId, USER_ID)
    expect(out.status).toBe('FAILED')
    const cp2 = await prisma.channelProduct.findUniqueOrThrow({ where: { id: cp2Id } })
    expect(cp2.keywords).toEqual(kws(29))
    expect(await prisma.keywordChangeLog.count({ where: { channelProductId: cp2Id } })).toBe(0)
  })

  test('생성 시점 30개 초과도 거부', async () => {
    await expect(
      propose({ target: { channelProductId: cp2Id }, add: ['a', 'b', 'c'], remove: [] })
    ).rejects.toThrow(/30개/)
  })
})
