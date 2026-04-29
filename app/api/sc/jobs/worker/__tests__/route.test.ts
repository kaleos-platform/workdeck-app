// /api/sc/jobs/worker GET — claimJobs + reapStaleClaims + 응답 평탄화 회귀.
// Prisma · jobs 모듈 · readChannelCredential · getAppOrigin 모두 mock.

import { NextRequest } from 'next/server'

jest.mock('@/lib/api-helpers', () => ({
  resolveWorkerAuth: jest.fn(() => ({ workerId: 'test-worker' })),
  errorResponse: (msg: string, status: number, extra?: Record<string, unknown>) =>
    new Response(JSON.stringify({ error: msg, ...extra }), { status }),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    contentDeployment: { findUnique: jest.fn() },
    salesContentJob: {},
  },
}))

jest.mock('@/lib/sc/jobs', () => ({
  claimJobs: jest.fn(),
  enqueueJob: jest.fn(),
  reapStaleClaims: jest.fn(),
}))

jest.mock('@/lib/sc/credentials', () => ({
  readChannelCredential: jest.fn(),
}))

jest.mock('@/lib/domain', () => ({
  getAppOrigin: () => 'https://app.test',
}))

import { GET } from '../route'
import { prisma } from '@/lib/prisma'
import { claimJobs, reapStaleClaims } from '@/lib/sc/jobs'
import { readChannelCredential } from '@/lib/sc/credentials'

const findUnique = prisma.contentDeployment.findUnique as jest.Mock
const mockClaim = claimJobs as jest.Mock
const mockReap = reapStaleClaims as jest.Mock
const mockReadCred = readChannelCredential as jest.Mock

const baseDeployment = {
  id: 'd1',
  channelId: 'c1',
  shortSlug: 'abc12',
  content: {
    id: 'ct1',
    title: 'T',
    doc: {},
    assets: [
      { slotKey: 'thumb', url: 'https://x/y.png', alt: 'thumb' },
      { slotKey: null, url: 'https://x/z.png', alt: null },
    ],
  },
  channel: { id: 'c1', platform: 'BLOG_NAVER' },
}

function makeReq(qs = ''): NextRequest {
  return new NextRequest(`http://test/api/sc/jobs/worker${qs}`, {
    headers: { 'x-worker-api-key': 'k' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockReap.mockResolvedValue(0)
  mockReadCred.mockResolvedValue({ payload: { storageState: '...' } })
})

describe('GET /api/sc/jobs/worker', () => {
  it('claimJobs 전에 reapStaleClaims 가 호출된다 (P1 #8)', async () => {
    mockClaim.mockResolvedValue([])
    await GET(makeReq())
    expect(mockReap).toHaveBeenCalledTimes(1)
    expect(mockClaim).toHaveBeenCalledTimes(1)
  })

  it('reapStaleClaims 실패해도 claim 진행 (graceful)', async () => {
    mockReap.mockRejectedValue(new Error('db down'))
    mockClaim.mockResolvedValue([])
    const res = (await GET(makeReq()))!
    expect(res.status).toBe(200)
    expect(mockClaim).toHaveBeenCalledTimes(1)
  })

  it('PUBLISH job 은 deployment+credential+assets+deploymentUrl 로 expand 된다', async () => {
    mockClaim.mockResolvedValue([
      { id: 'j1', kind: 'PUBLISH', targetId: 'd1', payload: {}, attempts: 1 },
    ])
    findUnique.mockResolvedValue(baseDeployment)

    const res = (await GET(makeReq()))!
    const body = (await res.json()) as { jobs: Array<Record<string, unknown>> }
    expect(body.jobs).toHaveLength(1)
    const expanded = body.jobs[0]
    expect(expanded.deployment).toMatchObject({ id: 'd1' })
    expect(expanded.credential).toMatchObject({ payload: expect.any(Object) })
    expect(expanded.assets).toEqual([
      { slotKey: 'thumb', url: 'https://x/y.png', alt: 'thumb' },
      { slotKey: null, url: 'https://x/z.png', alt: null },
    ])
    expect(expanded.deploymentUrl).toBe('https://app.test/c/abc12')
  })

  it('INSIGHT_SWEEP 은 deployment 조회를 스킵한다', async () => {
    mockClaim.mockResolvedValue([
      { id: 'j2', kind: 'INSIGHT_SWEEP', targetId: 'space-1', payload: {}, attempts: 0 },
    ])

    const res = (await GET(makeReq()))!
    expect(findUnique).not.toHaveBeenCalled()
    const body = (await res.json()) as { jobs: Array<Record<string, unknown>> }
    expect(body.jobs[0]).toEqual({
      job: expect.objectContaining({ kind: 'INSIGHT_SWEEP' }),
    })
  })

  it('deployment 가 사라진 PUBLISH job 은 job 만 반환 (graceful)', async () => {
    mockClaim.mockResolvedValue([
      { id: 'j3', kind: 'PUBLISH', targetId: 'd-gone', payload: {}, attempts: 1 },
    ])
    findUnique.mockResolvedValue(null)

    const res = (await GET(makeReq()))!
    const body = (await res.json()) as { jobs: Array<Record<string, unknown>> }
    expect(body.jobs[0].deployment).toBeUndefined()
    expect(mockReadCred).not.toHaveBeenCalled()
  })

  it('readChannelCredential 실패해도 credential=null 로 진행', async () => {
    mockClaim.mockResolvedValue([
      { id: 'j4', kind: 'PUBLISH', targetId: 'd1', payload: {}, attempts: 1 },
    ])
    findUnique.mockResolvedValue(baseDeployment)
    mockReadCred.mockRejectedValue(new Error('decrypt fail'))

    const res = (await GET(makeReq()))!
    const body = (await res.json()) as { jobs: Array<Record<string, unknown>> }
    expect(body.jobs[0].credential).toBeNull()
    // deployment 는 그대로 — publisher 가 ManualPublisher 등으로 fallback 가능.
    expect(body.jobs[0].deployment).toMatchObject({ id: 'd1' })
  })
})
