import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'
import { POST as completeJobRoute } from '../../../../app/api/sc/jobs/[id]/complete/route'
import { completeManualDeployment, normalizePlatformUrl } from '../manual-publish'

jest.mock('@/lib/worker-auth', () => ({
  authenticateWorker: jest.fn().mockResolvedValue({ scope: {} }),
  workerOwns: jest.fn().mockReturnValue(true),
}))

describe('normalizePlatformUrl', () => {
  it.each([
    [
      'https://blog.naver.com/meaning-lab/224457908512',
      'https://blog.naver.com/meaning-lab/224457908512',
    ],
    [
      'https://m.blog.naver.com/meaning-lab/224457908512?x=1',
      'https://blog.naver.com/meaning-lab/224457908512',
    ],
    [
      'https://blog.naver.com/PostView.naver?blogId=meaning-lab&logNo=123',
      'https://blog.naver.com/meaning-lab/123',
    ],
  ])('%s', (raw, expected) => {
    expect(normalizePlatformUrl('BLOG_NAVER', raw)).toBe(expected)
  })

  it.each([
    'https://evil.test/meaning-lab/1',
    'https://blog.naver.com/meaning-lab',
    'javascript:alert(1)',
    '주소',
  ])('거부: %s', (raw) => {
    expect(normalizePlatformUrl('BLOG_NAVER', raw)).toBeNull()
  })
})

const d = process.env.DATABASE_URL ? describe : describe.skip

d('completeManualDeployment', () => {
  let spaceId = ''
  let deploymentId = ''
  let contentId = ''
  const url = 'https://blog.naver.com/meaning-lab/1'

  beforeAll(async () => {
    const space = await prisma.space.create({ data: { name: 'sc-manual', type: 'PERSONAL' } })
    spaceId = space.id
  })

  beforeEach(async () => {
    const channel = await prisma.salesContentChannel.create({
      data: {
        spaceId,
        name: '블로그',
        platform: 'BLOG_NAVER',
        kind: 'BLOG',
        platformSlug: `b-${randomUUID().slice(0, 8)}`,
        publisherMode: 'MANUAL',
        collectorMode: 'MANUAL',
      },
    })
    const content = await prisma.content.create({
      data: { spaceId, title: '글', doc: {}, status: 'SCHEDULED', channelId: channel.id },
    })
    contentId = content.id
    const deployment = await prisma.contentDeployment.create({
      data: {
        spaceId,
        contentId,
        channelId: channel.id,
        shortSlug: randomUUID().slice(0, 12),
        targetUrl: 'https://a.test',
        status: 'AWAITING_MANUAL',
      },
    })
    deploymentId = deployment.id
  })

  afterAll(async () => {
    await prisma.space.delete({ where: { id: spaceId } })
    await prisma.$disconnect()
  })

  it('배포와 콘텐츠를 함께 게시 완료로 만든다', async () => {
    const r = await completeManualDeployment({ spaceId, deploymentId, platformUrl: url })
    expect(r).toEqual({ ok: true, platformUrl: url, alreadyDone: false })
    const dep = await prisma.contentDeployment.findUnique({ where: { id: deploymentId } })
    const content = await prisma.content.findUnique({ where: { id: contentId } })
    expect(dep).toMatchObject({ status: 'PUBLISHED', platformUrl: url })
    expect(dep?.publishedAt).not.toBeNull()
    expect(content?.status).toBe('PUBLISHED')
    expect(content?.publishedAt).not.toBeNull()
  })

  it('같은 주소 재요청은 성공, 다른 주소는 충돌', async () => {
    await completeManualDeployment({ spaceId, deploymentId, platformUrl: url })
    await expect(
      completeManualDeployment({ spaceId, deploymentId, platformUrl: url })
    ).resolves.toMatchObject({ ok: true, alreadyDone: true })
    await expect(
      completeManualDeployment({
        spaceId,
        deploymentId,
        platformUrl: 'https://blog.naver.com/meaning-lab/2',
      })
    ).resolves.toMatchObject({ ok: false, status: 409 })
  })

  it('동시 요청은 한 건만 전이한다', async () => {
    const results = await Promise.all([
      completeManualDeployment({ spaceId, deploymentId, platformUrl: url }),
      completeManualDeployment({ spaceId, deploymentId, platformUrl: url }),
    ])
    expect(results.every((r) => r.ok)).toBe(true)
    expect(results.filter((r) => r.ok && !r.alreadyDone)).toHaveLength(1)
  })

  it('워커 성공 보고는 수동 채널을 게시 대기로 둔다', async () => {
    await prisma.contentDeployment.update({
      where: { id: deploymentId },
      data: { status: 'PUBLISHING' },
    })
    const job = await prisma.salesContentJob.create({
      data: {
        spaceId,
        kind: 'PUBLISH',
        targetId: deploymentId,
        payload: {},
        status: 'CLAIMED',
      },
    })
    const res = await completeJobRoute(
      new NextRequest('http://t/x', { method: 'POST', body: JSON.stringify({ ok: true }) }),
      { params: Promise.resolve({ id: job.id }) }
    )
    expect(res.status).toBe(200)
    const dep = await prisma.contentDeployment.findUnique({ where: { id: deploymentId } })
    expect(dep).toMatchObject({ status: 'AWAITING_MANUAL', publishedAt: null })
  })

  it('열린 다른 채널 배포가 있으면 콘텐츠는 그대로 둔다', async () => {
    const dep = await prisma.contentDeployment.findUniqueOrThrow({ where: { id: deploymentId } })
    await prisma.contentDeployment.create({
      data: {
        spaceId,
        contentId,
        channelId: dep.channelId,
        shortSlug: randomUUID().slice(0, 12),
        targetUrl: 'https://a.test',
        status: 'SCHEDULED',
      },
    })
    await completeManualDeployment({ spaceId, deploymentId, platformUrl: url })
    const content = await prisma.content.findUnique({ where: { id: contentId } })
    expect(content?.status).toBe('SCHEDULED')
  })

  it('초안으로 되돌린 콘텐츠는 완료를 거부하고 배포를 유지한다', async () => {
    await prisma.content.update({ where: { id: contentId }, data: { status: 'DRAFT' } })
    await expect(
      completeManualDeployment({ spaceId, deploymentId, platformUrl: url })
    ).resolves.toMatchObject({ ok: false, status: 409 })
    const dep = await prisma.contentDeployment.findUnique({ where: { id: deploymentId } })
    expect(dep?.status).toBe('AWAITING_MANUAL')
  })

  it('다른 Space 의 배포는 찾지 못한다', async () => {
    await expect(
      completeManualDeployment({ spaceId: randomUUID(), deploymentId, platformUrl: url })
    ).resolves.toMatchObject({ ok: false, status: 404 })
  })
})
