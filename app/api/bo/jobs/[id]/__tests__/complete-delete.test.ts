// @jest-environment node
// DELETE_POST complete 경로 테스트
// completeBoJob / failBoJob 은 mock. 나머지(isBoRetryableErrorCode, BO_WORKER_ERROR_CODES)는 requireActual.

// eslint-disable-next-line no-var
var mockCompleteBoJob: jest.Mock
// eslint-disable-next-line no-var
var mockFailBoJob: jest.Mock

function ensureJobMocks() {
  if (!mockCompleteBoJob) mockCompleteBoJob = jest.fn()
  if (!mockFailBoJob) mockFailBoJob = jest.fn()
  return { mockCompleteBoJob, mockFailBoJob }
}

// ─── Prisma mock 변수 ────────────────────────────────────────────────────────
// eslint-disable-next-line no-var
var mockBoJob: { findUnique: jest.Mock }
// eslint-disable-next-line no-var
var mockBoDeployment: { updateMany: jest.Mock; findUnique: jest.Mock; count: jest.Mock }
// eslint-disable-next-line no-var
var mockBoPost: { findUnique: jest.Mock; update: jest.Mock }

function ensurePrismaMocks() {
  if (!mockBoJob) mockBoJob = { findUnique: jest.fn() }
  if (!mockBoDeployment) {
    mockBoDeployment = { updateMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() }
  }
  if (!mockBoPost) mockBoPost = { findUnique: jest.fn(), update: jest.fn() }
  return { mockBoJob, mockBoDeployment, mockBoPost }
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
    return {
      boJob: p.mockBoJob,
      boDeployment: p.mockBoDeployment,
      boPost: p.mockBoPost,
    }
  },
}))

// completeBoJob, failBoJob 만 mock — 나머지는 실제 구현 유지
jest.mock('@/lib/bo/jobs', () => {
  const actual = jest.requireActual('@/lib/bo/jobs') as Record<string, unknown>
  const m = ensureJobMocks()
  return {
    ...actual,
    completeBoJob: (...args: unknown[]) => m.mockCompleteBoJob(...args),
    failBoJob: (...args: unknown[]) => m.mockFailBoJob(...args),
  }
})

import { POST } from '../complete/route'

function makeReq(body: unknown): Parameters<typeof POST>[0] {
  return {
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0]
}

function makeParams(id: string): Parameters<typeof POST>[1] {
  return { params: Promise.resolve({ id }) }
}

describe('POST /api/bo/jobs/[id]/complete — DELETE_POST 경로', () => {
  beforeEach(() => {
    const jm = ensureJobMocks()
    const pm = ensurePrismaMocks()

    jm.mockCompleteBoJob.mockReset()
    jm.mockFailBoJob.mockReset()

    pm.mockBoJob.findUnique.mockReset()
    pm.mockBoDeployment.updateMany.mockReset()
    pm.mockBoDeployment.findUnique.mockReset()
    pm.mockBoDeployment.count.mockReset()
    pm.mockBoPost.findUnique.mockReset()
    pm.mockBoPost.update.mockReset()

    pm.mockBoDeployment.updateMany.mockResolvedValue({ count: 1 })
    pm.mockBoPost.update.mockResolvedValue({})
  })

  test('DELETE_POST 성공 → DELETED updateMany 호출 + 남은 PUBLISHED 0건 시 post PUBLISH_APPROVED 갱신', async () => {
    const jm = ensureJobMocks()
    const pm = ensurePrismaMocks()

    jm.mockCompleteBoJob.mockResolvedValue({ updated: true })

    pm.mockBoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      kind: 'DELETE_POST',
      targetId: 'dep-1',
    })

    pm.mockBoDeployment.findUnique.mockResolvedValue({ postId: 'post-1' })

    pm.mockBoPost.findUnique.mockResolvedValue({ id: 'post-1', status: 'PUBLISHED' })

    // 남은 PUBLISHED 배포 0건
    pm.mockBoDeployment.count.mockResolvedValue(0)

    const res = (await POST(makeReq({ ok: true }), makeParams('job-1')))!
    const body = await res.json()

    expect(body.ok).toBe(true)

    // DELETING → DELETED 전환 updateMany 확인
    expect(pm.mockBoDeployment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'dep-1', status: 'DELETING' }),
        data: expect.objectContaining({ status: 'DELETED' }),
      })
    )

    // post PUBLISH_APPROVED 갱신 확인
    expect(pm.mockBoPost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'post-1' },
        data: { status: 'PUBLISH_APPROVED' },
      })
    )
  })

  test('DELETE_POST 성공 + 남은 PUBLISHED 1건 → post 갱신 안 함', async () => {
    const jm = ensureJobMocks()
    const pm = ensurePrismaMocks()

    jm.mockCompleteBoJob.mockResolvedValue({ updated: true })

    pm.mockBoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      kind: 'DELETE_POST',
      targetId: 'dep-1',
    })

    pm.mockBoDeployment.findUnique.mockResolvedValue({ postId: 'post-1' })
    pm.mockBoPost.findUnique.mockResolvedValue({ id: 'post-1', status: 'PUBLISHED' })

    // 남은 PUBLISHED 배포 1건 — post 상태 변경 안 해야 함
    pm.mockBoDeployment.count.mockResolvedValue(1)

    const res = (await POST(makeReq({ ok: true }), makeParams('job-1')))!
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(pm.mockBoPost.update).not.toHaveBeenCalled()
  })

  test('DELETE_POST 최종 실패(finalized) → DELETING→PUBLISHED 복귀 updateMany', async () => {
    const jm = ensureJobMocks()
    const pm = ensurePrismaMocks()

    // finalized: true → PUBLISHED 복귀 경로
    jm.mockFailBoJob.mockResolvedValue({ updated: true, finalized: true })

    pm.mockBoJob.findUnique.mockResolvedValue({
      id: 'job-1',
      kind: 'DELETE_POST',
      targetId: 'dep-1',
    })

    const res = (await POST(
      makeReq({ ok: false, errorCode: 'DELETE_FAILED', errorMessage: '삭제 실패' }),
      makeParams('job-1')
    ))!
    const body = await res.json()

    expect(body.ok).toBe(true)

    // DELETING → PUBLISHED 복귀 확인 (플랫폼에 글이 살아있음)
    expect(pm.mockBoDeployment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'dep-1', status: 'DELETING' }),
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      })
    )
  })

  test('job 없음 → 404', async () => {
    const pm = ensurePrismaMocks()
    pm.mockBoJob.findUnique.mockResolvedValue(null)

    const res = (await POST(makeReq({ ok: true }), makeParams('not-exist')))!

    expect(res.status).toBe(404)
  })
})
