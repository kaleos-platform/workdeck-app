/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(async () => ({ space: { id: 's' }, user: { id: 'u' } })),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({ prisma: { $transaction: jest.fn() } }))
import { prisma } from '@/lib/prisma'

it('이미 저장된 상품의 URL 표현과 AI 상품명이 바뀌어도 중복 생성하지 않는다', async () => {
  const tx = {
    $queryRaw: jest.fn(),
    product: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            name: '기존 수납함',
            customFields: [
              { key: '출처', value: 'https://meaninglab.co.kr/product/detail.html?product_no=62' },
            ],
          },
        ]),
      create: jest.fn(),
    },
    persona: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    brandProfile: { upsert: jest.fn() },
    salesContentOnboarding: { upsert: jest.fn() },
  }
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (run) => run(tx))
  const response = await POST(
    new NextRequest('http://localhost/api/sc/onboarding/save', {
      method: 'POST',
      body: JSON.stringify({
        brandProfile: {
          companyName: '미닝랩',
          customFields: [{ key: '기존 근거', value: '유지할 내용' }],
        },
        products: [
          {
            name: '그린 펠트 수납박스',
            sourceUrl: 'https://meaninglab.co.kr/product/box/62/category/54/display/1/',
          },
        ],
        personas: [],
      }),
    })
  )
  if (!response) throw new Error('응답 없음')
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ savedProducts: 0, skippedProducts: 1 })
  expect(tx.product.create).not.toHaveBeenCalled()
  expect(tx.brandProfile.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      update: expect.objectContaining({
        customFields: [{ key: '기존 근거', value: '유지할 내용' }],
      }),
    })
  )
})
