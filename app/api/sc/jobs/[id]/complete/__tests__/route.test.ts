// /api/sc/jobs/[id]/complete — 핵심 분기 회귀 테스트.
// Prisma · jobs · notifications 는 모두 mock — 라우트의 분기 로직만 검증.

import { NextRequest } from 'next/server'

// jobs.ts 의 z.enum(WORKER_ERROR_CODES) 가 모듈 import 시점에 평가되므로
// jest.mock 은 import 전에 선언되도록 호이스팅에 의존한다.
jest.mock('@/lib/api-helpers', () => ({
  resolveWorkerAuth: jest.fn(() => ({ workerId: 'test-worker' })),
  errorResponse: (msg: string, status: number, extra?: Record<string, unknown>) =>
    new Response(JSON.stringify({ error: msg, ...extra }), { status }),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    salesContentJob: { findUnique: jest.fn() },
    contentDeployment: { updateMany: jest.fn() },
  },
}))

jest.mock('@/lib/sc/jobs', () => ({
  completeJob: jest.fn(),
  failJob: jest.fn(),
  isRetryableErrorCode: jest.fn(),
  WORKER_ERROR_CODES: [
    'AUTH_FAILED',
    'RATE_LIMITED',
    'VALIDATION',
    'PLATFORM_ERROR',
    'NOT_IMPLEMENTED',
    'NETWORK',
  ],
}))

jest.mock('@/lib/sc/notifications', () => ({
  notifyJobFailure: jest.fn(),
}))

import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { completeJob, failJob, isRetryableErrorCode } from '@/lib/sc/jobs'
import { notifyJobFailure } from '@/lib/sc/notifications'

const findUnique = prisma.salesContentJob.findUnique as jest.Mock
const updateMany = prisma.contentDeployment.updateMany as jest.Mock
const mockComplete = completeJob as jest.Mock
const mockFail = failJob as jest.Mock
const mockRetryable = isRetryableErrorCode as jest.Mock
const mockNotify = notifyJobFailure as jest.Mock

const baseJob = {
  id: 'j1',
  spaceId: 'space-1',
  kind: 'PUBLISH' as const,
  targetId: 'd1',
  status: 'CLAIMED' as const,
  attempts: 1,
}

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://test/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-worker-api-key': 'k' },
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ id: 'j1' })

// 라우트 inferred return 은 NextResponse | Response | undefined 가 될 수 있어
// `!` non-null assertion 으로 풀어서 사용. 모든 코드 경로가 실제로는 응답을 반환한다.
async function call(body: unknown): Promise<Response> {
  const res = await POST(makeReq(body), { params })
  return res!
}

beforeEach(() => {
  jest.clearAllMocks()
  findUnique.mockResolvedValue(baseJob)
  updateMany.mockResolvedValue({ count: 1 })
})

// ────────────────────────────────────────────────
// 성공 보고 (ok:true)
// ────────────────────────────────────────────────

describe('POST /complete — ok:true (PUBLISH)', () => {
  it('PUBLISHING → PUBLISHED 동기화 (정상)', async () => {
    mockComplete.mockResolvedValue({ updated: true })

    const res = await call({ ok: true, platformUrl: 'https://blog.naver.com/p/1' })
    expect(res.status).toBe(200)
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1', status: 'PUBLISHING' },
        data: expect.objectContaining({
          status: 'PUBLISHED',
          platformUrl: 'https://blog.naver.com/p/1',
        }),
      })
    )
  })

  it('이미 종료된 job 의 중복 보고는 deployment 를 건드리지 않는다 (P0 fix)', async () => {
    mockComplete.mockResolvedValue({ updated: false })

    const res = await call({ ok: true, platformUrl: 'https://x' })
    const body = (await res.json()) as { ok: boolean; noop?: boolean }
    expect(body.noop).toBe(true)
    expect(updateMany).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────
// 실패 보고 (ok:false)
// ────────────────────────────────────────────────

describe('POST /complete — ok:false', () => {
  it('retryable 실패는 deployment 를 PUBLISHING 그대로 둔다 (P1 fix)', async () => {
    mockRetryable.mockReturnValue(true)
    mockFail.mockResolvedValue({ updated: true, finalized: false })

    const res = await call({ ok: false, errorCode: 'PLATFORM_ERROR', errorMessage: 'transient' })
    expect(res.status).toBe(200)
    expect(updateMany).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('non-retryable 실패는 PUBLISHING → FAILED 로 동기화하고 notify 발사', async () => {
    mockRetryable.mockReturnValue(false)
    mockFail.mockResolvedValue({ updated: true, finalized: true })

    await call({ ok: false, errorCode: 'AUTH_FAILED', errorMessage: '세션 만료' })
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1', status: 'PUBLISHING' },
        data: expect.objectContaining({ status: 'FAILED' }),
      })
    )
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'j1',
        jobKind: 'PUBLISH',
        errorCode: 'AUTH_FAILED',
        errorMessage: '세션 만료',
      })
    )
  })

  it('이미 종료된 job 의 중복 ok:false 는 deployment/notify 모두 스킵 (P0 fix)', async () => {
    mockRetryable.mockReturnValue(false)
    mockFail.mockResolvedValue({ updated: false, finalized: true })

    const res = await call({ ok: false, errorCode: 'AUTH_FAILED', errorMessage: '세션 만료' })
    const body = (await res.json()) as { noop?: boolean }
    expect(body.noop).toBe(true)
    expect(updateMany).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('deployment.updateMany 가 throw 해도 notify 는 발사된다 (P1 fix)', async () => {
    mockRetryable.mockReturnValue(false)
    mockFail.mockResolvedValue({ updated: true, finalized: true })
    updateMany.mockRejectedValue(new Error('db transient'))

    const res = await call({ ok: false, errorCode: 'AUTH_FAILED', errorMessage: '세션 만료' })
    expect(res.status).toBe(200)
    expect(mockNotify).toHaveBeenCalledTimes(1)
  })
})

// ────────────────────────────────────────────────
// 입력 검증
// ────────────────────────────────────────────────

describe('POST /complete — 입력 검증', () => {
  it('알 수 없는 errorCode 는 400 반환 (z.enum drift 방지)', async () => {
    const res = await call({ ok: false, errorCode: 'SOMETHING_NEW', errorMessage: 'x' })
    expect(res.status).toBe(400)
  })

  it('job 이 없으면 404', async () => {
    findUnique.mockResolvedValue(null)
    const res = await call({ ok: true })
    expect(res.status).toBe(404)
  })
})
