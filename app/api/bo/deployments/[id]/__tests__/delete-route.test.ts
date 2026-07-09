// @jest-environment node

// ─── Mock hoist 변수 ─────────────────────────────────────────────────────────
// eslint-disable-next-line no-var
var mockBoDeployment: {
  findFirst: jest.Mock
  update: jest.Mock
  updateMany: jest.Mock
}
// eslint-disable-next-line no-var
var mockBoChannelCredential: { count: jest.Mock }
// eslint-disable-next-line no-var
var mockBoJob: { findFirst: jest.Mock }
// eslint-disable-next-line no-var
var mockEnqueueBoJob: jest.Mock

function ensureMocks() {
  if (!mockBoDeployment) {
    mockBoDeployment = {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    }
  }
  if (!mockBoChannelCredential) {
    mockBoChannelCredential = { count: jest.fn() }
  }
  if (!mockBoJob) {
    mockBoJob = { findFirst: jest.fn() }
  }
  if (!mockEnqueueBoJob) {
    mockEnqueueBoJob = jest.fn()
  }
  return { mockBoDeployment, mockBoChannelCredential, mockBoJob, mockEnqueueBoJob }
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
  resolveDeckContext: jest.fn().mockResolvedValue({ space: { id: 'space-1' } }),
  errorResponse: (message: string, status: number) => ({
    status,
    json: async () => ({ message }),
  }),
}))

jest.mock('@/lib/prisma', () => ({
  get prisma() {
    const m = ensureMocks()
    return {
      boDeployment: m.mockBoDeployment,
      boChannelCredential: m.mockBoChannelCredential,
      boJob: m.mockBoJob,
    }
  },
}))

jest.mock('@/lib/bo/jobs', () => ({
  enqueueBoJob: (...args: unknown[]) => ensureMocks().mockEnqueueBoJob(...args),
}))

import { POST } from '../delete/route'

// NextRequest 최소 stub
function makeReq(): Parameters<typeof POST>[0] {
  return {} as Parameters<typeof POST>[0]
}

function makeParams(id: string): Parameters<typeof POST>[1] {
  return { params: Promise.resolve({ id }) }
}

/** 성공 경로용 기본 deployment mock 값 */
function defaultDeployment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dep-1',
    status: 'PUBLISHED',
    platformUrl: 'https://blog.naver.com/test/123',
    spaceId: 'space-1',
    channel: {
      id: 'ch-1',
      platform: 'NAVER_BLOG',
      publisherMode: 'BROWSER',
    },
    ...overrides,
  }
}

describe('POST /api/bo/deployments/[id]/delete', () => {
  beforeEach(() => {
    const m = ensureMocks()
    m.mockBoDeployment.findFirst.mockReset()
    m.mockBoDeployment.update.mockReset()
    m.mockBoDeployment.update.mockResolvedValue({})
    m.mockBoChannelCredential.count.mockReset()
    m.mockBoJob.findFirst.mockReset()
    m.mockEnqueueBoJob.mockReset()
    m.mockEnqueueBoJob.mockResolvedValue({ id: 'job-1' })
  })

  test('PUBLISHED + NAVER_BLOG + BROWSER + 자격증명 존재 → 201 + DELETING + DELETE_POST enqueue', async () => {
    const m = ensureMocks()
    m.mockBoDeployment.findFirst.mockResolvedValue(defaultDeployment())
    m.mockBoChannelCredential.count.mockResolvedValue(1)
    m.mockBoJob.findFirst.mockResolvedValue(null) // 진행 중 job 없음

    const res = (await POST(makeReq(), makeParams('dep-1')))!
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.deployment.status).toBe('DELETING')

    // DELETING 상태로 update 호출 확인
    expect(m.mockBoDeployment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dep-1' },
        data: { status: 'DELETING' },
      })
    )

    // DELETE_POST job enqueue 확인
    expect(m.mockEnqueueBoJob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'DELETE_POST',
        targetId: 'dep-1',
      })
    )
  })

  test('status EXPORTED → 422 "PUBLISHED 상태의 배포만 삭제"', async () => {
    const m = ensureMocks()
    m.mockBoDeployment.findFirst.mockResolvedValue(defaultDeployment({ status: 'EXPORTED' }))
    // 나머지 가드는 통과 조건으로 설정
    m.mockBoChannelCredential.count.mockResolvedValue(1)
    m.mockBoJob.findFirst.mockResolvedValue(null)

    const res = (await POST(makeReq(), makeParams('dep-1')))!
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.message).toContain('PUBLISHED')
  })

  test('platform TISTORY → 422 "네이버 블로그만"', async () => {
    const m = ensureMocks()
    m.mockBoDeployment.findFirst.mockResolvedValue(
      defaultDeployment({
        channel: { id: 'ch-1', platform: 'TISTORY', publisherMode: 'BROWSER' },
      })
    )
    m.mockBoChannelCredential.count.mockResolvedValue(1)
    m.mockBoJob.findFirst.mockResolvedValue(null)

    const res = (await POST(makeReq(), makeParams('dep-1')))!
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.message).toContain('네이버 블로그')
  })

  test('이미 진행 중인 DELETE_POST job → 409 "이미 처리 중"', async () => {
    const m = ensureMocks()
    m.mockBoDeployment.findFirst.mockResolvedValue(defaultDeployment())
    m.mockBoChannelCredential.count.mockResolvedValue(1)
    m.mockBoJob.findFirst.mockResolvedValue({ id: 'job-existing' }) // inflight job 존재

    const res = (await POST(makeReq(), makeParams('dep-1')))!
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.message).toContain('처리 중')

    // enqueue 미호출 확인
    expect(m.mockEnqueueBoJob).not.toHaveBeenCalled()
  })

  test('배포를 찾을 수 없음 → 404', async () => {
    const m = ensureMocks()
    m.mockBoDeployment.findFirst.mockResolvedValue(null)

    const res = (await POST(makeReq(), makeParams('not-exist')))!

    expect(res.status).toBe(404)
  })
})
