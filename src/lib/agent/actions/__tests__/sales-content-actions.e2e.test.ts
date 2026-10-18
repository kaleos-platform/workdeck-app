/**
 * 세일즈 콘텐츠 게시물 제안 → 승인 1회 → 발행 예약 e2e — 실 dev DB.
 * 승인되면 Content(SCHEDULED)·ContentDeployment(PUBLISHING)·PUBLISH 작업이 함께 생기고,
 * 실행이 실패하면 반쯤 만든 게시물이 남지 않아야 한다.
 */
import { prisma } from '@/lib/prisma'
import { approveAndExecute } from '../execute'
import { salesContentTools } from '@/lib/agent/tools/sales-content-tools'
import type { McpToolContext } from '@/lib/agent/tools/types'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000d1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000d2'
const CHANNEL_ID = 'e2e00000-0000-4000-8000-0000000000d3'
const OTHER_SPACE_ID = 'e2e00000-0000-4000-8000-0000000000d4'

const propose = salesContentTools.find((t) => t.name === 'sc_propose_post')!
const ctx: McpToolContext = {
  spaceId: SPACE_ID,
  actor: { type: 'agent', id: 'ag-e2e' },
  scopes: ['sc:write'],
  workId: 'wk_e2e_sc',
  requesterUserId: null,
  requesterSlackUserId: null,
  decryptedCredentialIds: [],
}
const post = (title: string) => ({
  title,
  body: '# 크림드 소개\n\n크림드는 피부 장벽을 지키는 보습 크림을 만듭니다. 오늘은 겨울철 보습 루틴을 소개합니다.',
  channelId: CHANNEL_ID,
  targetUrl: 'https://example.com/product/1',
  scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
})

d('sales-content.post.publish', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-scpost@throwaway.test', name: 'E2E ScPost' },
    })
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E ScPost Throwaway', type: 'PERSONAL' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_ID, userId: USER_ID } },
      update: {},
      create: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' },
    })
    for (const spaceId of [SPACE_ID, OTHER_SPACE_ID]) {
      await prisma.space.upsert({
        where: { id: spaceId },
        update: {},
        create: { id: spaceId, name: 'E2E ScPost Throwaway', type: 'PERSONAL' },
      })
      await prisma.deckInstance.upsert({
        where: { spaceId_deckAppId: { spaceId, deckAppId: 'sales-content' } },
        update: { isActive: true },
        create: { spaceId, deckAppId: 'sales-content' },
      })
    }
  })

  beforeEach(async () => {
    await prisma.salesContentChannel.upsert({
      where: { id: CHANNEL_ID },
      update: { isActive: true },
      create: {
        id: CHANNEL_ID,
        spaceId: SPACE_ID,
        platform: 'BLOG_NAVER',
        kind: 'BLOG',
        name: 'E2E 블로그',
        platformSlug: 'naver-blog',
      },
    })
  })

  afterEach(async () => {
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.salesContentJob.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.content.deleteMany({ where: { spaceId: SPACE_ID } })
  })

  afterAll(async () => {
    await prisma.salesContentChannel.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: OTHER_SPACE_ID } })
    await prisma.deckInstance.deleteMany({ where: { spaceId: { in: [SPACE_ID, OTHER_SPACE_ID] } } })
    await prisma.spaceMember.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: { in: [SPACE_ID, OTHER_SPACE_ID] } } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
    await prisma.$disconnect()
  })

  test('승인 1회로 콘텐츠·배포·발행 작업이 함께 예약된다', async () => {
    const proposed = (await propose.execute(ctx, post('겨울 보습 루틴'))) as { actionId: string }
    expect(await prisma.content.count({ where: { spaceId: SPACE_ID } })).toBe(0)

    const out = await approveAndExecute(proposed.actionId, USER_ID)
    expect(out.status).toBe('EXECUTED')

    const content = await prisma.content.findFirstOrThrow({
      where: { spaceId: SPACE_ID },
      include: { deployments: true },
    })
    expect(content.status).toBe('SCHEDULED')
    expect(content.userId).toBe(USER_ID)
    expect((content.doc as { content: { type: string }[] }).content[0].type).toBe('heading')
    expect(content.deployments).toHaveLength(1)
    expect(content.deployments[0].status).toBe('PUBLISHING')
    const job = await prisma.salesContentJob.findFirstOrThrow({ where: { spaceId: SPACE_ID } })
    expect(job.kind).toBe('PUBLISH')
    expect(job.targetId).toBe(content.deployments[0].id)
  })

  test('같은 제안을 다시 보내도 승인 건은 하나', async () => {
    const p = post('중복 제안')
    const a = (await propose.execute(ctx, p)) as { actionId: string }
    const b = (await propose.execute(ctx, p)) as { actionId: string }
    expect(b.actionId).toBe(a.actionId)
  })

  test('승인 전에 채널이 꺼지면 실행 실패, 게시물은 남지 않는다', async () => {
    const p = post('채널 꺼짐')
    const proposed = (await propose.execute(ctx, p)) as { actionId: string }
    await prisma.salesContentChannel.update({
      where: { id: CHANNEL_ID },
      data: { isActive: false },
    })
    const out = await approveAndExecute(proposed.actionId, USER_ID)
    expect(out.status).toBe('FAILED')
    expect(await prisma.content.count({ where: { spaceId: SPACE_ID } })).toBe(0)
    expect(await prisma.salesContentJob.count({ where: { spaceId: SPACE_ID } })).toBe(0)

    // 채널을 되살린 뒤 같은 내용으로 다시 제안하면 실패한 건이 아니라 새 승인 건이 생긴다.
    await prisma.salesContentChannel.update({ where: { id: CHANNEL_ID }, data: { isActive: true } })
    const retried = (await propose.execute(ctx, p)) as { actionId: string }
    expect(retried.actionId).not.toBe(proposed.actionId)
  })

  test('다른 Space 채널로는 제안 자체가 거부된다', async () => {
    // OTHER_SPACE 에도 카드는 켜져 있다 — 카드 게이트가 아니라 채널 소속 검사로 막혀야 한다.
    await expect(propose.execute({ ...ctx, spaceId: OTHER_SPACE_ID }, post('x'))).rejects.toThrow(
      '활성 채널을 찾을 수 없습니다'
    )
    expect(await prisma.agentPendingAction.count({ where: { spaceId: OTHER_SPACE_ID } })).toBe(0)
  })
})

d('sales-content.post.publish 입력 검증', () => {
  test('targetUrl 은 http(s) 만 받는다', () => {
    const { postPublishParams } = jest.requireActual('../sales-content')
    expect(
      postPublishParams.safeParse({ ...post('x'), targetUrl: 'javascript:alert(1)' }).success
    ).toBe(false)
  })
})
