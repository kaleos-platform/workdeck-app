// @jest-environment node

// ─── Mock hoist 변수 ─────────────────────────────────────────────────────────
// eslint-disable-next-line no-var
var mockBoPostVariant: { findFirst: jest.Mock }
// eslint-disable-next-line no-var
var mockBoChannelCredential: { count: jest.Mock }
// eslint-disable-next-line no-var
var mockBoDeployment: { create: jest.Mock }
// eslint-disable-next-line no-var
var mockEnqueueBoJob: jest.Mock

function ensureMocks() {
  if (!mockBoPostVariant) {
    mockBoPostVariant = { findFirst: jest.fn() }
  }
  if (!mockBoChannelCredential) {
    mockBoChannelCredential = { count: jest.fn() }
  }
  if (!mockBoDeployment) {
    mockBoDeployment = { create: jest.fn() }
  }
  if (!mockEnqueueBoJob) {
    mockEnqueueBoJob = jest.fn()
  }
  return { mockBoPostVariant, mockBoChannelCredential, mockBoDeployment, mockEnqueueBoJob }
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
  errorResponse: (message: string, status: number, extra?: unknown) => ({
    status,
    json: async () => ({ message, ...(extra as object | undefined) }),
  }),
}))

jest.mock('@/lib/prisma', () => ({
  get prisma() {
    const m = ensureMocks()
    return {
      boPostVariant: m.mockBoPostVariant,
      boChannelCredential: m.mockBoChannelCredential,
      boDeployment: m.mockBoDeployment,
    }
  },
}))

jest.mock('@/lib/bo/jobs', () => ({
  enqueueBoJob: (...args: unknown[]) => ensureMocks().mockEnqueueBoJob(...args),
}))

import { POST } from '../publish/route'

function makeReq(body?: unknown): Parameters<typeof POST>[0] {
  return {
    json:
      body !== undefined
        ? async () => body
        : async () => {
            throw new Error('no body')
          },
  } as unknown as Parameters<typeof POST>[0]
}

function makeParams(id: string): Parameters<typeof POST>[1] {
  return { params: Promise.resolve({ id }) }
}

/** 기본 READY 변형 — BROWSER 채널 */
function defaultVariant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'var-1',
    postId: 'post-1',
    channelId: 'ch-1',
    status: 'READY',
    channel: { id: 'ch-1', publisherMode: 'BROWSER' },
    ...overrides,
  }
}

/** 기본 deployment create 반환값 — createdAt 필수 (route 에서 .toISOString() 호출) */
function defaultCreatedDeployment(scheduledAt: Date | null = null) {
  return {
    id: 'dep-new',
    status: 'PENDING',
    scheduledAt,
    createdAt: new Date('2026-07-08T00:00:00.000Z'),
  }
}

describe('POST /api/bo/variants/[id]/publish', () => {
  beforeEach(() => {
    const m = ensureMocks()
    m.mockBoPostVariant.findFirst.mockReset()
    m.mockBoChannelCredential.count.mockReset()
    m.mockBoDeployment.create.mockReset()
    m.mockEnqueueBoJob.mockReset()
    m.mockEnqueueBoJob.mockResolvedValue({ id: 'job-1' })
  })

  test('scheduledAt 과거 → 422 "2분 이후"', async () => {
    const m = ensureMocks()
    m.mockBoPostVariant.findFirst.mockResolvedValue(defaultVariant())
    m.mockBoChannelCredential.count.mockResolvedValue(1)

    const pastDate = new Date(Date.now() - 3_600_000).toISOString() // 1시간 전
    const res = (await POST(makeReq({ scheduledAt: pastDate }), makeParams('var-1')))!
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.message).toContain('2분')
  })

  test('scheduledAt +91일 → 422 "90일 이내"', async () => {
    const m = ensureMocks()
    m.mockBoPostVariant.findFirst.mockResolvedValue(defaultVariant())
    m.mockBoChannelCredential.count.mockResolvedValue(1)

    const farFuture = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000).toISOString()
    const res = (await POST(makeReq({ scheduledAt: farFuture }), makeParams('var-1')))!
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.message).toContain('90일')
  })

  test('scheduledAt +1시간 → 201 이고 enqueueBoJob 에 scheduledAt 전달됨', async () => {
    const m = ensureMocks()
    m.mockBoPostVariant.findFirst.mockResolvedValue(defaultVariant())
    m.mockBoChannelCredential.count.mockResolvedValue(1)

    const scheduled = new Date(Date.now() + 60 * 60 * 1000) // +1시간
    m.mockBoDeployment.create.mockResolvedValue(defaultCreatedDeployment(scheduled))

    const res = (await POST(
      makeReq({ scheduledAt: scheduled.toISOString() }),
      makeParams('var-1')
    ))!

    expect(res.status).toBe(201)

    // enqueueBoJob 에 scheduledAt 이 Date 형태로 전달되어야 함
    expect(m.mockEnqueueBoJob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'PUBLISH',
        scheduledAt: expect.any(Date),
      })
    )

    // 전달된 scheduledAt 이 입력값과 근접한지 확인 (±5초)
    const enqueuedScheduledAt: Date = m.mockEnqueueBoJob.mock.calls[0][0].scheduledAt
    expect(Math.abs(enqueuedScheduledAt.getTime() - scheduled.getTime())).toBeLessThan(5000)
  })

  test('body 없음 (즉시 발행) → 201 이고 enqueueBoJob scheduledAt undefined', async () => {
    const m = ensureMocks()
    m.mockBoPostVariant.findFirst.mockResolvedValue(defaultVariant())
    m.mockBoChannelCredential.count.mockResolvedValue(1)
    m.mockBoDeployment.create.mockResolvedValue(defaultCreatedDeployment(null))

    // body 없음 — json() throw → 즉시 발행 경로
    const res = (await POST(makeReq(), makeParams('var-1')))!

    expect(res.status).toBe(201)

    expect(m.mockEnqueueBoJob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'PUBLISH',
        scheduledAt: undefined,
      })
    )
  })

  test('변형을 찾을 수 없음 → 404', async () => {
    const m = ensureMocks()
    m.mockBoPostVariant.findFirst.mockResolvedValue(null)

    const res = (await POST(makeReq({}), makeParams('not-exist')))!

    expect(res.status).toBe(404)
  })
})
