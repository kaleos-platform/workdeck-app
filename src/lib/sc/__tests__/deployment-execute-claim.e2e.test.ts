/**
 * POST /api/sc/deployments/[id]/execute — 동시 실행 중복 enqueue 방지 e2e.
 *
 * 두 요청이 동시에 SCHEDULED deployment 를 execute 할 때 정확히 1건만 202 를 받고
 * 나머지는 409 로 차단되어야 한다. DB 상 status=PUBLISHING 행이 정확히 1건임을 확인.
 * 수정 전(findFirst+update 분리) 이면 두 요청 모두 202 → red.
 *
 * throwaway space/user 시드. afterAll cascade 로 0-state 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return { __esModule: true, ...actual, resolveDeckContext: jest.fn() }
})

jest.mock('@/lib/sc/jobs', () => ({
  enqueueJob: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
}))

import { resolveDeckContext } from '@/lib/api-helpers'
import { POST } from '../../../../app/api/sc/deployments/[id]/execute/route'

const SPACE_ID = 'e2e00000-0000-4000-8000-00000000ef01'
const USER_ID = 'e2e00000-0000-4000-8000-00000000ef02'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let deploymentId = ''

async function cleanup() {
  await prisma.contentDeployment.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.salesContentChannel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.content.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

function postReq(id: string) {
  return new NextRequest(`http://localhost/api/sc/deployments/${id}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

d('POST execute — 동시 실행 중복 enqueue 차단 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    await prisma.space.create({
      data: {
        id: SPACE_ID,
        name: 'e2e-sc-execute-claim',
      },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-sc-execute@test.invalid' },
    })

    const channel = await prisma.salesContentChannel.create({
      data: {
        spaceId: SPACE_ID,
        platform: 'BLOG_NAVER',
        kind: 'BLOG',
        name: 'e2e 채널',
        platformSlug: 'e2e-channel',
      },
    })

    const content = await prisma.content.create({
      data: {
        spaceId: SPACE_ID,
        title: 'e2e test content',
        doc: {},
        status: 'APPROVED',
      },
    })

    const deployment = await prisma.contentDeployment.create({
      data: {
        spaceId: SPACE_ID,
        contentId: content.id,
        channelId: channel.id,
        shortSlug: 'e2e-exec-claim-test',
        targetUrl: 'https://example.com',
        status: 'SCHEDULED',
      },
    })
    deploymentId = deployment.id

    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    // 각 테스트 전 SCHEDULED 로 초기화
    await prisma.contentDeployment.update({
      where: { id: deploymentId },
      data: { status: 'SCHEDULED', errorMessage: null },
    })
  })

  it('동시 요청 2건 중 정확히 1건만 202, 나머지는 409', async () => {
    const params = { params: Promise.resolve({ id: deploymentId }) }
    const results = await Promise.all([
      POST(postReq(deploymentId), params),
      POST(postReq(deploymentId), params),
    ])

    const statuses = (results as { status: number }[]).map((r) => r.status).sort()
    expect(statuses).toEqual([202, 409])

    // DB 상 PUBLISHING 상태 행은 정확히 1건
    const rows = await prisma.contentDeployment.findMany({
      where: { id: deploymentId, status: 'PUBLISHING' },
    })
    expect(rows).toHaveLength(1)
  })

  it('이미 PUBLISHING 상태면 단일 요청도 409', async () => {
    await prisma.contentDeployment.update({
      where: { id: deploymentId },
      data: { status: 'PUBLISHING' },
    })
    const response = await POST(postReq(deploymentId), { params: Promise.resolve({ id: deploymentId }) }) as { status: number }
    expect(response.status).toBe(409)
  })
})
