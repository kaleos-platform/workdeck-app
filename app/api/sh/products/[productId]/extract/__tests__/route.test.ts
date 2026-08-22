/** @jest-environment node */

// Jest mock factory가 import 전에 평가되므로 var로 hoist 가능한 mock 저장소를 둔다.
// eslint-disable-next-line no-var
var mockProduct: { findFirst: jest.Mock; update: jest.Mock }
// eslint-disable-next-line no-var
var mockJob: {
  create: jest.Mock
  update: jest.Mock
  updateMany: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  delete: jest.Mock
}
// eslint-disable-next-line no-var
var mockSource: { createMany: jest.Mock }

function ensureMockProduct() {
  if (!mockProduct) {
    mockProduct = { findFirst: jest.fn(), update: jest.fn() }
  }
  return mockProduct
}

function ensureMockJob() {
  if (!mockJob) {
    mockJob = {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    }
  }
  return mockJob
}

function ensureMockSource() {
  if (!mockSource) {
    mockSource = { createMany: jest.fn() }
  }
  return mockSource
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
  resolveDeckContext: jest.fn().mockResolvedValue({
    space: { id: 'space-1' },
    user: { id: 'user-1' },
  }),
  errorResponse: (message: string, status: number, extra?: Record<string, unknown>) => ({
    status,
    json: async () => ({ message, ...extra }),
  }),
}))

jest.mock('@/lib/prisma', () => ({
  get prisma() {
    type MockPrisma = {
      invProduct: ReturnType<typeof ensureMockProduct>
      productExtractionJob: ReturnType<typeof ensureMockJob>
      productExtractionSource: ReturnType<typeof ensureMockSource>
      $transaction: (cb: (tx: MockPrisma) => unknown) => Promise<unknown>
    }
    const p: MockPrisma = {
      invProduct: ensureMockProduct(),
      productExtractionJob: ensureMockJob(),
      productExtractionSource: ensureMockSource(),
      $transaction: async (cb) => cb(p),
    }
    return p
  },
}))

jest.mock('@/lib/ai/credit', () => {
  const actual = jest.requireActual('@/lib/ai/credit')
  return {
    ...actual,
    reserveTextCredit: jest.fn(),
    commitTextCredit: jest.fn(),
    refundTextCredit: jest.fn(),
  }
})

import { TextCreditExceededError, reserveTextCredit } from '@/lib/ai/credit'
import { POST as extractPost, GET as extractGet } from '../route'
import { POST as applyPost } from '../[jobId]/apply/route'

function jsonRequest(body: unknown) {
  return { json: async () => body } as Parameters<typeof extractPost>[0]
}

describe('POST /api/sh/products/[productId]/extract', () => {
  beforeEach(() => {
    const product = ensureMockProduct()
    const job = ensureMockJob()
    const source = ensureMockSource()
    product.findFirst.mockReset()
    product.update.mockReset()
    job.create.mockReset()
    job.update.mockReset()
    job.updateMany.mockReset()
    job.findFirst.mockReset()
    job.findMany.mockReset()
    job.delete.mockReset()
    source.createMany.mockReset()
    ;(reserveTextCredit as jest.Mock).mockReset()
    ;(reserveTextCredit as jest.Mock).mockResolvedValue({
      reservationId: 'log-1',
      yearMonth: '2026-08',
      textUsedAfter: 1,
      textQuota: 200,
    })

    product.findFirst.mockResolvedValue({ id: 'product-1', name: '테스트 상품' })
  })

  test('다른 Space의 storagePath를 참조하는 파일은 400으로 거부한다', async () => {
    const res = (await extractPost(
      jsonRequest({
        pastedText: '테스트용 상세 설명 텍스트입니다.',
        files: [
          {
            // space-1/products/product-1/... 접두사가 아니므로 isOwnedSourcePath가 false
            storagePath: 'other-space/products/other-product/x.png',
            fileName: 'x.png',
            mimeType: 'image/png',
            byteSize: 1000,
          },
        ],
      }),
      { params: Promise.resolve({ productId: 'product-1' }) }
    ))!

    expect(res.status).toBe(400)
    expect(mockJob.create).not.toHaveBeenCalled()
  })

  test('첨부 파일 합계 용량이 12MB를 초과하면 413을 반환한다', async () => {
    const sevenMb = 7 * 1024 * 1024
    const res = (await extractPost(
      jsonRequest({
        files: [
          {
            storagePath: 'space-1/products/product-1/a.png',
            fileName: 'a.png',
            mimeType: 'image/png',
            byteSize: sevenMb,
          },
          {
            storagePath: 'space-1/products/product-1/b.png',
            fileName: 'b.png',
            mimeType: 'image/png',
            byteSize: sevenMb,
          },
        ],
      }),
      { params: Promise.resolve({ productId: 'product-1' }) }
    ))!

    expect(res.status).toBe(413)
    expect(mockJob.create).not.toHaveBeenCalled()
  })

  test('월간 텍스트 크레딧이 소진되면 429를 반환한다', async () => {
    ;(reserveTextCredit as jest.Mock).mockRejectedValue(new TextCreditExceededError('2026-08'))

    const res = (await extractPost(
      jsonRequest({ pastedText: '테스트용 상세 설명 텍스트입니다.' }),
      { params: Promise.resolve({ productId: 'product-1' }) }
    ))!
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(429)
    expect(body.code).toBe('TEXT_CREDIT_EXCEEDED')
    expect(mockJob.create).not.toHaveBeenCalled()
  })
})

describe('GET /api/sh/products/[productId]/extract', () => {
  beforeEach(() => {
    ensureMockProduct().findFirst.mockReset()
    ensureMockJob().updateMany.mockReset()
    ensureMockJob().findMany.mockReset()
    ensureMockProduct().findFirst.mockResolvedValue({ id: 'product-1' })
    ensureMockJob().updateMany.mockResolvedValue({ count: 0 })
    ensureMockJob().findMany.mockResolvedValue([])
  })

  test('10분 넘게 RUNNING인 잡을 조회 전에 FAILED(TIMEOUT)로 전환한다', async () => {
    const req = { url: 'http://localhost/api/sh/products/product-1/extract' } as Parameters<
      typeof extractGet
    >[0]
    await extractGet(req, { params: Promise.resolve({ productId: 'product-1' }) })

    expect(mockJob.updateMany).toHaveBeenCalledTimes(1)
    const call = mockJob.updateMany.mock.calls[0][0] as {
      where: { status: string; createdAt: { lt: Date } }
      data: { status: string; errorCode: string }
    }
    expect(call.where.status).toBe('RUNNING')
    expect(call.data.status).toBe('FAILED')
    expect(call.data.errorCode).toBe('TIMEOUT')

    // updateMany가 findMany보다 먼저 호출돼야 조회 결과에 즉시 반영된다.
    const updateManyOrder = mockJob.updateMany.mock.invocationCallOrder[0]
    const findManyOrder = mockJob.findMany.mock.invocationCallOrder[0]
    expect(updateManyOrder).toBeLessThan(findManyOrder)
  })
})

describe('POST /api/sh/products/[productId]/extract/[jobId]/apply', () => {
  beforeEach(() => {
    ensureMockProduct().findFirst.mockReset()
    ensureMockProduct().update.mockReset()
    ensureMockJob().findFirst.mockReset()
    ensureMockJob().update.mockReset()
  })

  test('apply는 InvProduct를 쓰지 않고 appliedAt도 찍지 않는다', async () => {
    ensureMockJob().findFirst.mockResolvedValue({
      id: 'job-1',
      status: 'SUCCEEDED',
      appliedAt: null,
      result: {
        description: '추출된 설명입니다.',
        features: ['기능1'],
        certifications: [],
        ingredients: [],
        capacity: null,
        originCountry: '대한민국',
        manufacturer: '제조사A',
        cautions: [],
        confidence: 0.9,
        notes: null,
        truncatedFields: [],
      },
    })
    ensureMockProduct().findFirst.mockResolvedValue({
      description: '기존 설명',
      features: [],
      certifications: [],
      manufacturer: null,
      manufactureCountry: null,
    })
    ensureMockJob().update.mockResolvedValue({})

    const res = (await applyPost(
      jsonRequest({ fields: ['description', 'manufacturer'] }) as Parameters<typeof applyPost>[0],
      { params: Promise.resolve({ productId: 'product-1', jobId: 'job-1' }) }
    ))!
    const body = (await res.json()) as {
      values: Record<string, unknown>
      before: Record<string, unknown>
    }

    expect(res.status).toBe(200)
    expect(body.values.description).toBe('추출된 설명입니다.')
    expect(body.before.description).toBe('기존 설명')

    // InvProduct.update는 절대 호출되지 않는다 — 값은 폼 state를 거쳐 기존 autosave가 쓴다.
    expect(mockProduct.update).not.toHaveBeenCalled()

    // 잡 row는 appliedBefore/appliedFields 스냅샷만 저장하고 appliedAt은 찍지 않는다.
    expect(mockJob.update).toHaveBeenCalledTimes(1)
    const updateData = mockJob.update.mock.calls[0][0].data as Record<string, unknown>
    expect(updateData).not.toHaveProperty('appliedAt')
    expect(updateData).toHaveProperty('appliedBefore')
    expect(updateData).toHaveProperty('appliedFields')
  })

  test('재적용 시 최초 appliedBefore 스냅샷을 덮어쓰지 않는다', async () => {
    // apply → autosave 성공 → applied 호출 실패 → 사용자가 다시 apply 하는 시나리오.
    // 이때 InvProduct 는 이미 AI 값으로 덮여 있으므로, 스냅샷을 갱신하면 롤백이
    // 원본이 아니라 AI 값을 복원하게 된다. 최초 스냅샷이 보존되어야 한다.
    ensureMockJob().findFirst.mockResolvedValue({
      id: 'job-1',
      status: 'SUCCEEDED',
      appliedAt: null,
      appliedBefore: { description: '진짜 원본 설명' },
      result: {
        description: '추출된 설명입니다.',
        features: [],
        certifications: [],
        manufacturer: '(주)에이엠엘',
        originCountry: null,
      },
    })
    ensureMockProduct().findFirst.mockResolvedValue({
      description: '추출된 설명입니다.', // 이미 적용되어 덮인 상태
      features: [],
      certifications: [],
      manufacturer: '(주)에이엠엘',
      manufactureCountry: null,
    })
    ensureMockJob().update.mockResolvedValue({})

    const res = (await applyPost(
      jsonRequest({ fields: ['description'] }) as Parameters<typeof applyPost>[0],
      { params: Promise.resolve({ productId: 'product-1', jobId: 'job-1' }) }
    ))!
    expect(res.status).toBe(200)

    expect(mockJob.update).toHaveBeenCalledTimes(1)
    const updateData = mockJob.update.mock.calls[0][0].data as Record<string, unknown>
    // appliedFields 는 갱신하되 appliedBefore 는 건드리지 않는다.
    expect(updateData).toHaveProperty('appliedFields')
    expect(updateData).not.toHaveProperty('appliedBefore')
  })

  test('롤백된 잡을 다시 적용하면 스냅샷을 새로 잡는다', async () => {
    // 롤백 후 재적용은 새 사이클이다. 이전 사이클 스냅샷을 남기면 롤백이 그때 적용했던
    // 필드만 되돌리고, 이번에 적용한 나머지는 AI 값인 채로 남는다.
    ensureMockJob().findFirst.mockResolvedValue({
      id: 'job-1',
      status: 'SUCCEEDED',
      appliedAt: new Date('2026-08-22T00:00:00Z'),
      rolledBackAt: new Date('2026-08-22T01:00:00Z'),
      appliedBefore: { features: [] },
      result: {
        description: '추출된 설명입니다.',
        features: ['A'],
        certifications: [],
        manufacturer: '(주)에이엠엘',
        originCountry: null,
      },
    })
    ensureMockProduct().findFirst.mockResolvedValue({
      description: null,
      features: [],
      certifications: [],
      manufacturer: null,
      manufactureCountry: null,
    })
    ensureMockJob().update.mockResolvedValue({})

    const res = (await applyPost(
      jsonRequest({ fields: ['description', 'manufacturer'] }) as Parameters<typeof applyPost>[0],
      { params: Promise.resolve({ productId: 'product-1', jobId: 'job-1' }) }
    ))!
    expect(res.status).toBe(200)

    const updateData = mockJob.update.mock.calls[0][0].data as Record<string, unknown>
    expect(updateData.appliedFields).toEqual(['description', 'manufacturer'])
    expect(updateData).toHaveProperty('appliedBefore')
    expect(updateData).not.toHaveProperty('appliedAt')
  })
})
