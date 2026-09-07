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
var mockSource: { createMany: jest.Mock; update: jest.Mock }

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
    mockSource = { createMany: jest.fn(), update: jest.fn() }
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

// 실제 스토리지 다운로드(Supabase) 없이 파일 소재 흐름을 검증하기 위한 모킹.
jest.mock('@/lib/sh/product-source-storage', () => {
  const actual = jest.requireActual('@/lib/sh/product-source-storage')
  return {
    ...actual,
    downloadProductSourceFile: jest.fn(),
  }
})

// 실제 Gemini 호출 없이 소재(텍스트/이미지) 취합 로직만 검증하기 위한 모킹.
// 모듈 최상단은 @google/genai를 타입으로만 import하므로 requireActual이 안전하다.
jest.mock('@/lib/sh/product-extract', () => {
  const actual = jest.requireActual('@/lib/sh/product-extract')
  return {
    ...actual,
    extractProductInfo: jest.fn(),
  }
})

// SSRF 가드를 실제로 태우지 않고, 라우트가 개별 이미지 실패/성공/한도초과를 어떻게
// 다루는지만 검증하기 위한 모킹. safeFetchBinary 자체의 SSRF 동작은
// src/lib/net/__tests__/safe-fetch.test.ts 에서 별도로 검증한다.
jest.mock('@/lib/net/safe-fetch', () => {
  const actual = jest.requireActual('@/lib/net/safe-fetch')
  return {
    ...actual,
    safeFetchBinary: jest.fn(),
  }
})

import { TextCreditExceededError, reserveTextCredit } from '@/lib/ai/credit'
import { downloadProductSourceFile } from '@/lib/sh/product-source-storage'
import { extractProductInfo, EXTRACT_PROMPT_VERSION } from '@/lib/sh/product-extract'
import { safeFetchBinary, SafeFetchError } from '@/lib/net/safe-fetch'
import { POST as extractPost, GET as extractGet } from '../route'
import { POST as applyPost } from '../[jobId]/apply/route'

const mockDownloadProductSourceFile = downloadProductSourceFile as jest.Mock
const mockExtractProductInfo = extractProductInfo as jest.Mock
const mockSafeFetchBinary = safeFetchBinary as jest.Mock

const SUCCESS_RESULT = {
  description: '추출된 설명입니다.',
  features: [],
  certifications: [],
  ingredients: [],
  capacity: null,
  originCountry: null,
  manufacturer: null,
  cautions: [],
  confidence: 0.5,
  notes: null,
  truncatedFields: [],
}

/** job.create + job.update(트랜잭션 내부/최종) 모킹 — 성공 경로 테스트 공용 헬퍼. */
function mockJobPersistence(sources: Array<Record<string, unknown>>) {
  mockJob.create.mockResolvedValue({ id: 'job-1' })
  mockJob.update.mockImplementation((args: { data: { status?: string } }) => {
    if (args.data.status === 'RUNNING') {
      return Promise.resolve({ id: 'job-1', sources })
    }
    return Promise.resolve({ id: 'job-1', sources, ...args.data })
  })
}

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
    source.update.mockReset()
    source.update.mockResolvedValue({})
    mockDownloadProductSourceFile.mockReset()
    mockExtractProductInfo.mockReset()
    mockExtractProductInfo.mockResolvedValue({
      result: SUCCESS_RESULT,
      raw: '{}',
      model: 'gemini-2.5-flash',
      usage: { inputTokens: 10, outputTokens: 5 },
      latencyMs: 100,
    })
    mockSafeFetchBinary.mockReset()
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

  test('URL 상세이미지 1장이 실패해도 나머지로 추출은 성공한다', async () => {
    mockJobPersistence([{ id: 'src-url-1', kind: 'URL', url: 'https://shop.example.com/p/1' }])
    mockSafeFetchBinary
      .mockRejectedValueOnce(new SafeFetchError('FETCH_FAILED', '요청에 실패했습니다'))
      .mockResolvedValueOnce({
        finalUrl: 'https://img.example.com/2.jpg',
        bytes: Buffer.from([1, 2, 3]),
        mimeType: 'image/jpeg',
      })

    const res = (await extractPost(
      jsonRequest({
        url: 'https://shop.example.com/p/1',
        urlText: '상세페이지 텍스트',
        imageUrls: ['https://img.example.com/1.jpg', 'https://img.example.com/2.jpg'],
      }),
      { params: Promise.resolve({ productId: 'product-1' }) }
    ))!
    const body = (await res.json()) as { job: { status: string; result: Record<string, unknown> } }

    expect(res.status).toBe(200)
    expect(body.job.status).toBe('SUCCEEDED')
    expect(body.job.result.imageFetchStats).toEqual({
      requested: 2,
      succeeded: 1,
      failed: 1,
      skippedByteLimit: 0,
    })
    expect(mockSafeFetchBinary).toHaveBeenCalledTimes(2)

    // extractProductInfo에 넘어간 parts: 텍스트(URL 소재) 1개 + 성공한 이미지 1개.
    const partsArg = mockExtractProductInfo.mock.calls[0][0].parts as Array<{ kind: string }>
    expect(partsArg.filter((p) => p.kind === 'text')).toHaveLength(1)
    expect(partsArg.filter((p) => p.kind === 'inline')).toHaveLength(1)
  })

  test('잡 생성 시 현재 프롬프트 버전을 명시적으로 기록한다', async () => {
    mockJobPersistence([{ id: 'src-text-1', kind: 'TEXT' }])

    const res = (await extractPost(jsonRequest({ pastedText: '상품 소개 텍스트' }), {
      params: Promise.resolve({ productId: 'product-1' }),
    }))!

    expect(res.status).toBe(200)
    // DB default('v1')에 의존하지 않고 코드가 값을 써야 신/구 프롬프트 결과를 구분할 수 있다.
    expect(mockJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ promptVersion: EXTRACT_PROMPT_VERSION }),
      })
    )
  })

  test('업로드 파일 + URL 이미지 합계가 12MB 상한에 닿으면 남은 이미지는 skippedByteLimit로 남고 추출은 계속된다', async () => {
    mockJobPersistence([
      { id: 'src-url-1', kind: 'URL', url: 'https://shop.example.com/p/1' },
      {
        id: 'src-file-1',
        kind: 'IMAGE',
        storagePath: 'space-1/products/product-1/a.png',
        mimeType: 'image/png',
        fileName: 'a.png',
      },
    ])
    const tenMb = 10 * 1024 * 1024
    mockDownloadProductSourceFile.mockResolvedValue(Buffer.alloc(tenMb, 1))
    // 10MB(파일) + 3MB(이미지1) > 12MB 상한 → 첫 이미지 시도 후 나머지는 못 받는다.
    mockSafeFetchBinary.mockResolvedValue({
      finalUrl: 'https://img.example.com/1.jpg',
      bytes: Buffer.alloc(3 * 1024 * 1024, 1),
      mimeType: 'image/jpeg',
    })

    const res = (await extractPost(
      jsonRequest({
        url: 'https://shop.example.com/p/1',
        urlText: '상세페이지 텍스트',
        files: [
          {
            storagePath: 'space-1/products/product-1/a.png',
            fileName: 'a.png',
            mimeType: 'image/png',
            byteSize: tenMb,
          },
        ],
        imageUrls: ['https://img.example.com/1.jpg', 'https://img.example.com/2.jpg'],
      }),
      { params: Promise.resolve({ productId: 'product-1' }) }
    ))!
    const body = (await res.json()) as { job: { status: string; result: Record<string, unknown> } }

    expect(res.status).toBe(200)
    expect(body.job.status).toBe('SUCCEEDED')
    expect(body.job.result.imageFetchStats).toEqual({
      requested: 2,
      succeeded: 0,
      failed: 0,
      skippedByteLimit: 2,
    })
    // 예산 초과가 확인된 첫 이미지만 실제로 내려받고, 두 번째는 시도조차 하지 않는다.
    expect(mockSafeFetchBinary).toHaveBeenCalledTimes(1)
  })

  test('사설 IP를 가리키는 이미지 URL은 거부되고, 다른 소재로 추출은 계속된다', async () => {
    mockJobPersistence([{ id: 'src-url-1', kind: 'URL', url: 'https://shop.example.com/p/1' }])
    mockSafeFetchBinary.mockRejectedValue(
      new SafeFetchError('PRIVATE_ADDRESS', '사설/예약 대역 주소는 허용되지 않습니다')
    )

    const res = (await extractPost(
      jsonRequest({
        url: 'https://shop.example.com/p/1',
        urlText: '상세페이지 텍스트',
        imageUrls: ['http://169.254.169.254/x.jpg'],
      }),
      { params: Promise.resolve({ productId: 'product-1' }) }
    ))!
    const body = (await res.json()) as { job: { status: string; result: Record<string, unknown> } }

    expect(res.status).toBe(200)
    expect(body.job.status).toBe('SUCCEEDED')
    expect(body.job.result.imageFetchStats).toEqual({
      requested: 1,
      succeeded: 0,
      failed: 1,
      skippedByteLimit: 0,
    })

    // 실패한 이미지는 소재에 섞이지 않는다 — inline part 0개.
    const partsArg = mockExtractProductInfo.mock.calls[0][0].parts as Array<{ kind: string }>
    expect(partsArg.filter((p) => p.kind === 'inline')).toHaveLength(0)
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
