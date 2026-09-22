/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(async () => ({ space: { id: 's' }, user: { id: 'u' } })),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    scOnboardingResource: { findMany: jest.fn(), updateMany: jest.fn() },
    salesContentOnboarding: { upsert: jest.fn(), update: jest.fn() },
    textGenerationLog: { create: jest.fn() },
  },
}))
jest.mock('@/lib/ai/resolve', () => ({
  generateTextForSpace: jest.fn(),
  AiNotConfiguredError: class extends Error {},
  ByokKeyError: class extends Error {},
}))
jest.mock('@/lib/sc/product-import/extract', () => ({
  extractSalesProduct: jest.fn(),
  readProductPage: jest.fn(),
  EmptyProductSourceError: class extends Error {},
}))
import { prisma } from '@/lib/prisma'
import { generateTextForSpace } from '@/lib/ai/resolve'
import { extractSalesProduct } from '@/lib/sc/product-import/extract'

const db = prisma as unknown as {
  scOnboardingResource: { findMany: jest.Mock; updateMany: jest.Mock }
  salesContentOnboarding: { upsert: jest.Mock; update: jest.Mock }
  textGenerationLog: { create: jest.Mock }
}
function resource(id: number, analyzed: boolean) {
  const page = {
    version: 1,
    kind: 'product',
    title: `상품 ${id}`,
    text: '상품 상세',
    imageUrls: [],
    sourceUrl: `https://example.com/products/${id}`,
    ...(analyzed
      ? {
          analysis: {
            audience: 'ESG',
            draft: { name: `상품 ${id}`, sourceUrl: `https://example.com/products/${id}` },
          },
        }
      : {}),
  }
  return {
    id: String(id),
    sourceUrl: page.sourceUrl,
    status: 'DONE',
    extractedText: JSON.stringify(page),
  }
}
const request = () =>
  new NextRequest('http://localhost/api/sc/onboarding/generate', {
    method: 'POST',
    body: JSON.stringify({ audience: 'ESG' }),
  })
beforeEach(() => {
  jest.clearAllMocks()
  db.salesContentOnboarding.update.mockImplementation(async ({ data }) => data)
  db.scOnboardingResource.updateMany.mockResolvedValue({ count: 1 })
  db.textGenerationLog.create.mockResolvedValue({})
})

it('분석 완료한 12개 상품 모두를 최종 초안에 유지한다', async () => {
  db.scOnboardingResource.findMany.mockResolvedValue(
    Array.from({ length: 12 }, (_, i) => resource(i, true))
  )
  jest
    .mocked(generateTextForSpace)
    .mockResolvedValue({
      providerName: 'test',
      mode: 'WORKDECK',
      result: {
        content: JSON.stringify({
          brandProfile: { companyName: '브랜드' },
          products: [],
          personas: [],
        }),
        latencyMs: 1,
      },
    })
  const response = await POST(request())
  if (!response) throw new Error('응답 없음')
  const json = await response.json()
  expect(response.status).toBe(200)
  expect(json.done).toBe(true)
  expect(json.draft.products).toHaveLength(12)
  expect(extractSalesProduct).not.toHaveBeenCalled()
})

it('다음 미분석 상품 한 개만 분석해 저장하고 재개 진행률을 반환한다', async () => {
  db.scOnboardingResource.findMany.mockResolvedValue([
    resource(0, true),
    resource(1, false),
    resource(2, false),
  ])
  jest
    .mocked(extractSalesProduct)
    .mockResolvedValue({
      draft: {
        name: '상품 1',
        oneLinerPitch: '',
        customFields: [],
        isActive: true,
        warnings: [],
        sourceUrl: 'https://example.com/products/1',
      },
      providerName: 'test',
      model: 'test',
      imageAnalysis: { requested: 0, read: 0, tiles: 0 },
    })
  const response = await POST(request())
  if (!response) throw new Error('응답 없음')
  expect(await response.json()).toMatchObject({ done: false, progress: { completed: 2, total: 3 } })
  expect(extractSalesProduct).toHaveBeenCalledTimes(1)
  expect(db.scOnboardingResource.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ id: '1', spaceId: 's' }) })
  )
})
