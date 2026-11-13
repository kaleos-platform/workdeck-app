/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { invalidateDeckReleaseCache } from '@/lib/billing/deck-release'
import { PATCH } from '../route'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    billingDeckProduct: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
  },
}))
jest.mock('@/lib/admin/auth', () => ({
  requireOperator: jest.fn(),
  writeAuditLog: jest.fn(),
}))
jest.mock('@/lib/billing/deck-release', () => ({ invalidateDeckReleaseCache: jest.fn() }))

const p = prisma as unknown as {
  billingDeckProduct: { findUnique: jest.Mock; update: jest.Mock; count: jest.Mock }
}

const patch = (deckId: string, body: unknown) =>
  PATCH(
    new Request(`http://localhost/api/admin/billing/products/${deckId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ deckId }) }
  )

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(requireOperator).mockResolvedValue({ ok: true, user: { id: 'op1' } } as never)
  p.billingDeckProduct.update.mockImplementation(({ where, data }) =>
    Promise.resolve({ id: where.id, ...data })
  )
})

describe('PATCH released — 공개/준비중 토글', () => {
  it('공개 전환: 저장·감사로그·마케팅 캐시 무효화', async () => {
    p.billingDeckProduct.findUnique.mockResolvedValue({ id: 'finance', released: false })
    const res = await patch('finance', { released: true })
    expect(res.status).toBe(200)
    expect(p.billingDeckProduct.update).toHaveBeenCalledWith({
      where: { id: 'finance' },
      data: { released: true },
    })
    expect(writeAuditLog).toHaveBeenCalledWith(
      'op1',
      'billing.product.update',
      'billingDeckProduct',
      'finance',
      expect.anything()
    )
    expect(invalidateDeckReleaseCache).toHaveBeenCalled()
  })

  it('마지막 공개 업무는 준비중으로 바꿀 수 없다 (판매 상품 1개 이상 유지)', async () => {
    p.billingDeckProduct.findUnique.mockResolvedValue({ id: 'recruiting', released: true })
    p.billingDeckProduct.count.mockResolvedValue(1)
    const res = await patch('recruiting', { released: false })
    expect(res.status).toBe(409)
    expect(p.billingDeckProduct.update).not.toHaveBeenCalled()
  })

  it('가격만 바꾸면 캐시 무효화하지 않는다', async () => {
    p.billingDeckProduct.findUnique.mockResolvedValue({ id: 'finance', released: false })
    await patch('finance', { monthlyPrice: 1000 })
    expect(invalidateDeckReleaseCache).not.toHaveBeenCalled()
  })
})
