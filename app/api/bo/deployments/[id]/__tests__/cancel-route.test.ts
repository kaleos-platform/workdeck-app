// @jest-environment node

// ─── Mock hoist 변수 ─────────────────────────────────────────────────────────
// eslint-disable-next-line no-var
var mockBoDeployment: { findFirst: jest.Mock; update: jest.Mock }
// eslint-disable-next-line no-var
var mockBoJob: { updateMany: jest.Mock }

function ensureMocks() {
  if (!mockBoDeployment) {
    mockBoDeployment = { findFirst: jest.fn(), update: jest.fn() }
  }
  if (!mockBoJob) {
    mockBoJob = { updateMany: jest.fn() }
  }
  return { mockBoDeployment, mockBoJob }
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
      boJob: m.mockBoJob,
    }
  },
}))

import { POST } from '../cancel/route'

function makeReq(): Parameters<typeof POST>[0] {
  return {} as Parameters<typeof POST>[0]
}

function makeParams(id: string): Parameters<typeof POST>[1] {
  return { params: Promise.resolve({ id }) }
}

describe('POST /api/bo/deployments/[id]/cancel', () => {
  beforeEach(() => {
    const m = ensureMocks()
    m.mockBoDeployment.findFirst.mockReset()
    m.mockBoDeployment.update.mockReset()
    m.mockBoDeployment.update.mockResolvedValue({})
    m.mockBoJob.updateMany.mockReset()
    m.mockBoJob.updateMany.mockResolvedValue({ count: 1 })
  })

  test('PENDING 배포 취소 시 boJob.updateMany 가 PUBLISH job FAILED 종결 인자로 호출됨', async () => {
    const m = ensureMocks()
    m.mockBoDeployment.findFirst.mockResolvedValue({ id: 'dep-1', status: 'PENDING' })

    const res = (await POST(makeReq(), makeParams('dep-1')))!
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.deployment.status).toBe('CANCELED')

    // deployment CANCELED 전환 확인
    expect(m.mockBoDeployment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dep-1' },
        data: { status: 'CANCELED' },
      })
    )

    // PUBLISH job FAILED 종결 — 사용자 취소 메시지 포함
    expect(m.mockBoJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          targetId: 'dep-1',
          kind: 'PUBLISH',
          status: expect.objectContaining({ in: expect.arrayContaining(['PENDING', 'CLAIMED']) }),
        }),
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: expect.any(String),
        }),
      })
    )
  })

  test('PENDING 이 아닌 배포 취소 → 422', async () => {
    const m = ensureMocks()
    m.mockBoDeployment.findFirst.mockResolvedValue({ id: 'dep-2', status: 'PUBLISHED' })

    const res = (await POST(makeReq(), makeParams('dep-2')))!
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.message).toContain('PENDING')
    // job updateMany 미호출
    expect(m.mockBoJob.updateMany).not.toHaveBeenCalled()
  })

  test('배포를 찾을 수 없음 → 404', async () => {
    const m = ensureMocks()
    m.mockBoDeployment.findFirst.mockResolvedValue(null)

    const res = (await POST(makeReq(), makeParams('not-exist')))!

    expect(res.status).toBe(404)
  })
})
