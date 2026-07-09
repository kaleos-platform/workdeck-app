// @jest-environment node

// ─── Mock hoist 변수 ─────────────────────────────────────────────────────────
// eslint-disable-next-line no-var
var mockCompleteBoJob: jest.Mock
// eslint-disable-next-line no-var
var mockClaimNextBoJob: jest.Mock
// eslint-disable-next-line no-var
var mockReapStaleBoClaims: jest.Mock

function ensureJobMocks() {
  if (!mockCompleteBoJob) mockCompleteBoJob = jest.fn()
  if (!mockClaimNextBoJob) mockClaimNextBoJob = jest.fn()
  if (!mockReapStaleBoClaims) mockReapStaleBoClaims = jest.fn()
  return { mockCompleteBoJob, mockClaimNextBoJob, mockReapStaleBoClaims }
}

// eslint-disable-next-line no-var
var mockBoDeployment: { findUnique: jest.Mock; updateMany: jest.Mock }
// eslint-disable-next-line no-var
var mockGetBoCredential: jest.Mock

function ensurePrismaMocks() {
  if (!mockBoDeployment) {
    mockBoDeployment = { findUnique: jest.fn(), updateMany: jest.fn() }
  }
  return { mockBoDeployment }
}

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

jest.mock('@/lib/api-helpers', () => ({
  resolveWorkerAuth: jest.fn().mockReturnValue({}), // 인증 통과
  errorResponse: (message: string, status: number) => ({
    status,
    json: async () => ({ message }),
  }),
}))

jest.mock('@/lib/prisma', () => ({
  get prisma() {
    const p = ensurePrismaMocks()
    return { boDeployment: p.mockBoDeployment }
  },
}))

jest.mock('@/lib/bo/jobs', () => {
  const m = ensureJobMocks()
  return {
    claimNextBoJob: (...args: unknown[]) => m.mockClaimNextBoJob(...args),
    completeBoJob: (...args: unknown[]) => m.mockCompleteBoJob(...args),
    reapStaleBoClaims: (...args: unknown[]) => m.mockReapStaleBoClaims(...args),
  }
})

jest.mock('@/lib/bo/credentials', () => ({
  get getBoCredential() {
    return mockGetBoCredential
  },
}))

import { POST } from '../route'

function makeReq(body: unknown): Parameters<typeof POST>[0] {
  return {
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0]
}

const BASE_PUBLISH_JOB = { id: 'job-1', kind: 'PUBLISH', targetId: 'dep-1' }

const BASE_DEPLOYMENT = {
  id: 'dep-1',
  status: 'PENDING',
  channelId: 'ch-1',
  variant: { id: 'v-1', title: '제목', doc: null, exportedMarkdown: null },
  channel: { id: 'ch-1', platform: 'NAVER_BLOG', name: '네이버', config: {} },
}

describe('POST /api/bo/jobs/claim — PUBLISH 레이스 조건', () => {
  beforeEach(() => {
    mockGetBoCredential = jest.fn().mockResolvedValue(null)
    const jm = ensureJobMocks()
    const pm = ensurePrismaMocks()

    jm.mockReapStaleBoClaims.mockResolvedValue(0)
    jm.mockClaimNextBoJob.mockReset()
    jm.mockCompleteBoJob.mockReset()
    jm.mockCompleteBoJob.mockResolvedValue({ updated: true })

    pm.mockBoDeployment.findUnique.mockReset()
    pm.mockBoDeployment.updateMany.mockReset()
    pm.mockBoDeployment.updateMany.mockResolvedValue({ count: 1 })
  })

  test('정상 경로: PENDING 배포 claim → context 반환', async () => {
    const jm = ensureJobMocks()
    const pm = ensurePrismaMocks()

    jm.mockClaimNextBoJob.mockResolvedValue(BASE_PUBLISH_JOB)

    // findUnique 첫 번째(사전 가드): PENDING, 두 번째(재조회): PUBLISHING
    pm.mockBoDeployment.findUnique
      .mockResolvedValueOnce({ ...BASE_DEPLOYMENT, status: 'PENDING' })
      .mockResolvedValueOnce({ status: 'PUBLISHING' })

    const res = (await POST(makeReq({ claimedBy: 'worker-1' })))!
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.job).toBeDefined()
    expect(body.context).toBeDefined()
    expect(body.context.deployment.id).toBe('dep-1')
    // completeBoJob 무해화 미호출 확인
    expect(jm.mockCompleteBoJob).not.toHaveBeenCalled()
  })

  test('claim-vs-cancel 레이스: updateMany 후 재조회 status 가 CANCELED → 무해화 후 { job: null } 반환', async () => {
    const jm = ensureJobMocks()
    const pm = ensurePrismaMocks()

    jm.mockClaimNextBoJob.mockResolvedValue(BASE_PUBLISH_JOB)

    // 사전 가드: PENDING 통과, updateMany 후 재조회: CANCELED (cancel 이 레이스 창에 끼어든 경우)
    pm.mockBoDeployment.findUnique
      .mockResolvedValueOnce({ ...BASE_DEPLOYMENT, status: 'PENDING' })
      .mockResolvedValueOnce({ status: 'CANCELED' })

    const res = (await POST(makeReq({ claimedBy: 'worker-1' })))!
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.job).toBeNull()
    // 무해화 completeBoJob 호출 확인
    expect(jm.mockCompleteBoJob).toHaveBeenCalledWith('job-1')
  })

  test('사전 가드: 이미 CANCELED 배포 → 무해화 후 { job: null } 반환', async () => {
    const jm = ensureJobMocks()
    const pm = ensurePrismaMocks()

    jm.mockClaimNextBoJob.mockResolvedValue(BASE_PUBLISH_JOB)

    // 사전 findUnique 에서 이미 CANCELED
    pm.mockBoDeployment.findUnique.mockResolvedValueOnce({
      ...BASE_DEPLOYMENT,
      status: 'CANCELED',
    })

    const res = (await POST(makeReq({ claimedBy: 'worker-1' })))!
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.job).toBeNull()
    expect(jm.mockCompleteBoJob).toHaveBeenCalledWith('job-1')
    // updateMany 미호출 — 사전 가드에서 차단됨
    expect(pm.mockBoDeployment.updateMany).not.toHaveBeenCalled()
  })

  test('job 없음 → { job: null } 반환', async () => {
    const jm = ensureJobMocks()
    jm.mockClaimNextBoJob.mockResolvedValue(null)

    const res = (await POST(makeReq({ claimedBy: 'worker-1' })))!
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.job).toBeNull()
  })
})
