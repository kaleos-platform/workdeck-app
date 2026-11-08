/**
 * OSMU 발행 요청 → 제안(사진 지정) → 승인 e2e — 실 dev DB.
 * 사진 복사본은 미리 만들어 둬 드라이브 호출 없이 돈다(복사 자체는 사용자 준비 후 실검증).
 */
import { prisma } from '@/lib/prisma'
import { approveAndExecute } from '@/lib/agent/actions/execute'
import { salesContentTools } from '@/lib/agent/tools/sales-content-tools'
import type { McpToolContext } from '@/lib/agent/tools/types'

const d = process.env.DATABASE_URL ? describe : describe.skip

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000005a1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000005a2'
const CHANNEL_ID = 'e2e00000-0000-4000-8000-0000000005a3'

const propose = salesContentTools.find((t) => t.name === 'sc_propose_post')!
const ctx: McpToolContext = {
  spaceId: SPACE_ID,
  actor: { type: 'agent', id: 'ag-e2e' },
  scopes: ['sc:write'],
  workId: 'wk_e2e_osmu',
  requesterUserId: null,
  requesterSlackUserId: null,
  decryptedCredentialIds: [],
}

const BODY =
  '# 환경교육 후기\n참가자 30명이 키트를 만들었습니다. 길이를 맞추려고 문장을 더 붙입니다.\n[사진: 만드는 모습]\n둘째 문단입니다.\n[사진: 완성품]\n끝.'

let sourceId = ''
let versionId = ''
const media: Record<string, string> = {}

async function makeRequest(pageId: string) {
  return prisma.scPublishRequest.create({
    data: {
      spaceId: SPACE_ID,
      notionPageId: pageId,
      snapshot: {},
      revision: '2026-11-08T00:00:00.000Z',
      sourceId,
      sourceVersionId: versionId,
      state: 'READY',
    },
  })
}

async function seedCopy(requestId: string, key: string) {
  return prisma.scMediaCopy.create({
    data: {
      spaceId: SPACE_ID,
      requestId,
      mediaId: media[key],
      md5: `md5-${key}`,
      storagePath: `${SPACE_ID}/content/osmu-${requestId}/${key}.jpg`,
      url: `https://storage.test/${key}.jpg`,
      mimeType: 'image/jpeg',
    },
  })
}

d('OSMU 발행 요청 승인', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-osmu@throwaway.test', name: 'E2E OSMU' },
    })
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E OSMU Throwaway', type: 'PERSONAL' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_ID, userId: USER_ID } },
      update: {},
      create: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' },
    })
    await prisma.deckInstance.upsert({
      where: { spaceId_deckAppId: { spaceId: SPACE_ID, deckAppId: 'sales-content' } },
      update: { isActive: true },
      create: { spaceId: SPACE_ID, deckAppId: 'sales-content' },
    })
    await prisma.salesContentChannel.upsert({
      where: { id: CHANNEL_ID },
      update: {},
      create: {
        id: CHANNEL_ID,
        spaceId: SPACE_ID,
        platform: 'BLOG_NAVER',
        kind: 'BLOG',
        name: 'E2E OSMU 블로그',
        platformSlug: 'naver-osmu',
        publisherMode: 'ASIDE',
        config: { aside: { autoPublish: false, blogId: 'meaning-lab' } },
      },
    })
    const source = await prisma.scSource.create({
      data: { spaceId: SPACE_ID, notionPageId: 'src-page', title: '환경교육', latestVersion: 1 },
    })
    sourceId = source.id
    const version = await prisma.scSourceVersion.create({
      data: { sourceId, version: 1, data: {}, rawText: '참가자 30명', contentHash: 'h1' },
    })
    versionId = version.id
    const mk = (key: string, faceStatus: 'NO_FACE' | 'FACE') =>
      prisma.scMedia.create({
        data: {
          spaceId: SPACE_ID,
          sourceId,
          driveFileId: `drive-${key}`,
          driveFolderId: 'folder',
          path: '환경교육',
          name: `${key}.jpg`,
          mimeType: 'image/jpeg',
          md5: `md5-${key}`,
          driveModifiedAt: new Date(),
          faceStatus,
        },
      })
    for (const [key, face] of [
      ['a', 'NO_FACE'],
      ['b', 'NO_FACE'],
      ['face', 'FACE'],
    ] as const) {
      media[key] = (await mk(key, face)).id
    }
  })

  afterAll(async () => {
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.salesContentJob.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.scPublishRequest.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.content.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.scMedia.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.scSource.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.salesContentChannel.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.deckInstance.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.spaceMember.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: SPACE_ID } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
    await prisma.$disconnect()
  })

  test('모든 자리를 소재 사진으로 채우면 승인 즉시 발행 예약 + 요청·소재 버전 연결', async () => {
    const request = await makeRequest('req-1')
    await seedCopy(request.id, 'a')
    await seedCopy(request.id, 'b')
    const proposed = (await propose.execute(ctx, {
      title: 'OSMU 글',
      body: BODY,
      channelId: CHANNEL_ID,
      targetUrl: 'https://tally.so/r/x',
      requestId: request.id,
      photos: [
        { slot: 1, mediaId: media.a },
        { slot: 2, mediaId: media.b },
      ],
    })) as { actionId: string }
    expect(
      (await prisma.scPublishRequest.findUniqueOrThrow({ where: { id: request.id } })).state
    ).toBe('PROPOSED')

    // 웹 확인 없이는 승인 불가(사진·소재 기반)
    const blocked = await approveAndExecute(proposed.actionId, USER_ID)
    expect(blocked.status).not.toBe('EXECUTED')

    const out = await approveAndExecute(proposed.actionId, USER_ID, { webReviewed: true })
    expect(out.status).toBe('EXECUTED')

    const after = await prisma.scPublishRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: { content: { include: { deployments: true, assets: true } } },
    })
    expect(after.state).toBe('APPROVED')
    expect(after.content!.sourceVersionId).toBe(versionId)
    expect(after.content!.assets.map((a) => a.url).sort()).toEqual([
      'https://storage.test/a.jpg',
      'https://storage.test/b.jpg',
    ])
    const dep = after.content!.deployments[0]
    expect(dep.status).toBe('PUBLISHING')
    expect(await prisma.salesContentJob.count({ where: { targetId: dep.id } })).toBe(1)

    // 같은 요청으로 다시 제안하면 거부
    await expect(
      propose.execute(ctx, {
        title: 'OSMU 글 2',
        body: BODY,
        channelId: CHANNEL_ID,
        targetUrl: 'https://tally.so/r/x',
        requestId: request.id,
      })
    ).rejects.toThrow('작성 대기 상태의 발행 요청이 아닙니다')
  })

  test('얼굴 사진·요청 없는 photos 는 제안 단계에서 거부', async () => {
    const request = await makeRequest('req-2')
    await expect(
      propose.execute(ctx, {
        title: '얼굴 글',
        body: BODY,
        channelId: CHANNEL_ID,
        targetUrl: 'https://tally.so/r/x',
        requestId: request.id,
        photos: [{ slot: 1, mediaId: media.face }],
      })
    ).rejects.toThrow('게시 허용되지 않은 사진')
    await expect(
      propose.execute(ctx, {
        title: '요청 없는 글',
        body: BODY,
        channelId: CHANNEL_ID,
        targetUrl: 'https://tally.so/r/x',
        photos: [{ slot: 1, mediaId: media.a }],
      })
    ).rejects.toThrow('requestId')
  })

  test('일부 자리만 채우면 사진 대기로 남고 채운 자리는 미리 지정된다', async () => {
    const request = await makeRequest('req-3')
    await seedCopy(request.id, 'a')
    const proposed = (await propose.execute(ctx, {
      title: 'OSMU 부분 사진',
      body: BODY,
      channelId: CHANNEL_ID,
      targetUrl: 'https://tally.so/r/x',
      requestId: request.id,
      photos: [{ slot: 2, mediaId: media.a }],
    })) as { actionId: string }
    const out = await approveAndExecute(proposed.actionId, USER_ID, { webReviewed: true })
    expect(out.status).toBe('EXECUTED')
    const dep = await prisma.contentDeployment.findFirstOrThrow({
      where: { spaceId: SPACE_ID, content: { title: 'OSMU 부분 사진' } },
    })
    expect(dep.status).toBe('AWAITING_ASSETS')
    const plan = dep.assetPlan as { slots: { index: number; assetId?: string }[] }
    expect(plan.slots[0].assetId).toBeUndefined()
    expect(plan.slots[1].assetId).toBeTruthy()
  })
})
