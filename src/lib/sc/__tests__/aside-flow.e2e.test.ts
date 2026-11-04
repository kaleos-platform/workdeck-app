/**
 * Aside 자동 게시 흐름 e2e — 실 dev DB.
 * 승인 → 사진 대기 → 사진 등록 완료(발행 예약) → 발행 시도 1회 → 워커 결과(리허설·게시·확인 필요).
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { approveAndExecute } from '@/lib/agent/actions/execute'
import { salesContentTools } from '@/lib/agent/tools/sales-content-tools'
import type { McpToolContext } from '@/lib/agent/tools/types'
import { saveAssetPlan } from '../asset-plan'
import type { PublishSnapshot } from '../aside-publish'
import { POST as completeJobRoute } from '../../../../app/api/sc/jobs/[id]/complete/route'
import { POST as publishAttemptRoute } from '../../../../app/api/sc/jobs/[id]/publish-attempt/route'

jest.mock('@/lib/worker-auth', () => ({
  authenticateWorker: jest.fn().mockResolvedValue({ scope: {} }),
  workerOwns: jest.fn().mockReturnValue(true),
}))

const d = process.env.DATABASE_URL ? describe : describe.skip

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000e1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000e2'
const CHANNEL_ID = 'e2e00000-0000-4000-8000-0000000000e3'

const propose = salesContentTools.find((t) => t.name === 'sc_propose_post')!
const ctx: McpToolContext = {
  spaceId: SPACE_ID,
  actor: { type: 'agent', id: 'ag-e2e' },
  scopes: ['sc:write'],
  workId: 'wk_e2e_aside',
  requesterUserId: null,
  requesterSlackUserId: null,
  decryptedCredentialIds: [],
}

async function approvePost(title: string, body: string) {
  const proposed = (await propose.execute(ctx, {
    title,
    body,
    channelId: CHANNEL_ID,
    targetUrl: 'https://tally.so/r/x',
    tags: ['환경교육'],
  })) as { actionId: string }
  const out = await approveAndExecute(proposed.actionId, USER_ID, { webReviewed: true })
  expect(out.status).toBe('EXECUTED')
  return prisma.contentDeployment.findFirstOrThrow({
    where: { spaceId: SPACE_ID, content: { title } },
  })
}

function req(body: unknown) {
  return new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

async function claimJob(deploymentId: string) {
  const job = await prisma.salesContentJob.findFirstOrThrow({ where: { targetId: deploymentId } })
  await prisma.salesContentJob.update({
    where: { id: job.id },
    data: { status: 'CLAIMED', claimedAt: new Date(), attempts: 1 },
  })
  return job.id
}

d('Aside 자동 게시', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-aside@throwaway.test', name: 'E2E Aside' },
    })
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E Aside Throwaway', type: 'PERSONAL' },
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
        name: 'E2E Aside 블로그',
        platformSlug: 'naver-aside',
        publisherMode: 'ASIDE',
        config: { aside: { autoPublish: false, blogId: 'meaning-lab', defaultCategory: '자료실' } },
      },
    })
  })

  afterAll(async () => {
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.salesContentJob.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.content.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.salesContentChannel.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.deckInstance.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.spaceMember.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: SPACE_ID } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
    await prisma.$disconnect()
  })

  test('사진 자리가 있으면 사진 대기 → 등록 완료 시 한 번만 발행 예약', async () => {
    const dep = await approvePost(
      '사진 있는 글',
      '# 소제목\n첫 문단입니다. 환경교육 키트를 소개합니다.\n[사진: 구성품]\n둘째 문단 [문의 링크]\n[사진: 완성품]\n끝 문단입니다.'
    )
    expect(dep.status).toBe('AWAITING_ASSETS')
    expect(await prisma.salesContentJob.count({ where: { targetId: dep.id } })).toBe(0)
    const snap = dep.publishSnapshot as unknown as PublishSnapshot
    expect(snap.category).toBe('자료실')
    expect(snap.tags).toEqual(['환경교육'])
    expect(snap.autoPublish).toBe(false)

    // 빈 자리가 있으면 완료 불가
    const empty = await saveAssetPlan({
      spaceId: SPACE_ID,
      deploymentId: dep.id,
      plan: { slots: [{ index: 1, skip: true }] },
      complete: true,
    })
    expect(empty.ok).toBe(false)

    const asset = await prisma.contentAsset.create({
      data: {
        spaceId: SPACE_ID,
        contentId: dep.contentId,
        kind: 'IMAGE',
        url: 'https://storage.test/a.png',
        storagePath: 'a.png',
        mimeType: 'image/png',
      },
    })
    const plan = { slots: [{ index: 0, assetId: asset.id }, { index: 1, skip: true }] }
    const done = await saveAssetPlan({ spaceId: SPACE_ID, deploymentId: dep.id, plan, complete: true })
    expect(done.ok).toBe(true)
    const again = await saveAssetPlan({ spaceId: SPACE_ID, deploymentId: dep.id, plan, complete: true })
    expect(again).toMatchObject({ ok: false, status: 409 })

    const after = await prisma.contentDeployment.findUniqueOrThrow({ where: { id: dep.id } })
    expect(after.status).toBe('PUBLISHING')
    const blocks = (after.publishSnapshot as unknown as PublishSnapshot).blocks
    expect(blocks.filter((b) => b.kind === 'photo')).toEqual([
      { kind: 'photo', index: 0, label: '구성품', assetId: asset.id },
    ])
    expect(await prisma.salesContentJob.count({ where: { targetId: dep.id } })).toBe(1)

    // 리허설 결과 → 게시 대기
    const jobId = await claimJob(dep.id)
    const first = await (await publishAttemptRoute(req({}), params(jobId))).json()
    const second = await (await publishAttemptRoute(req({}), params(jobId))).json()
    expect([first.ok, second.ok]).toEqual([true, false])
    await completeJobRoute(req({ ok: true, draftSaved: true }), params(jobId))
    const draft = await prisma.contentDeployment.findUniqueOrThrow({ where: { id: dep.id } })
    expect(draft.status).toBe('AWAITING_MANUAL')
    expect(draft.errorMessage).toContain('임시저장')
    // 사람에게 넘긴 배포는 자동 재게시 잠금
    expect(draft.publishAttemptedAt).not.toBeNull()
  })

  test('사진 없는 글은 바로 발행 예약, 게시 성공 시 배포·콘텐츠 완료', async () => {
    const dep = await approvePost('사진 없는 글', '# 소제목\n사진이 없는 짧은 글입니다. 바로 게시해도 됩니다. 길이를 맞추려고 문장을 하나 더 붙입니다.')
    expect(dep.status).toBe('PUBLISHING')
    const jobId = await claimJob(dep.id)
    await completeJobRoute(
      req({ ok: true, platformUrl: 'https://m.blog.naver.com/meaning-lab/123' }),
      params(jobId)
    )
    const after = await prisma.contentDeployment.findUniqueOrThrow({
      where: { id: dep.id },
      include: { content: true },
    })
    expect(after.status).toBe('PUBLISHED')
    expect(after.platformUrl).toBe('https://blog.naver.com/meaning-lab/123')
    expect(after.content.status).toBe('PUBLISHED')
  })

  test('결과 확인이 필요하면 재시도하지 않고 사람에게 넘긴다', async () => {
    const dep = await approvePost('확인 필요 글', '# 소제목\n결과가 불명확한 경우를 시험하는 짧은 글입니다. 길이를 맞추려고 문장을 하나 더 붙입니다.')
    const jobId = await claimJob(dep.id)
    await completeJobRoute(
      req({ ok: false, errorCode: 'NEEDS_REVIEW', errorMessage: '발행 결과 확인 실패' }),
      params(jobId)
    )
    const job = await prisma.salesContentJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(job.status).toBe('FAILED')
    const after = await prisma.contentDeployment.findUniqueOrThrow({ where: { id: dep.id } })
    expect(after.status).toBe('AWAITING_MANUAL')
    expect(after.errorMessage).toBe('발행 결과 확인 실패')
  })
})
