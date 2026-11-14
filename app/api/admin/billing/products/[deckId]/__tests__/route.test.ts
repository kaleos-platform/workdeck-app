/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { invalidateDeckReleaseCache } from '@/lib/billing/deck-release'
import { PATCH } from '../route'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    billingDeckProduct: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/lib/admin/auth', () => ({
  requireOperator: jest.fn(),
  writeAuditLog: jest.fn(),
}))
jest.mock('@/lib/billing/deck-release', () => ({
  ...jest.requireActual('@/lib/billing/deck-release'),
  invalidateDeckReleaseCache: jest.fn(),
}))
jest.mock('server-only', () => ({}))
jest.mock('next/cache', () => ({ unstable_cache: (f: unknown) => f, revalidateTag: jest.fn() }))

const p = prisma as unknown as {
  billingDeckProduct: { findUnique: jest.Mock; update: jest.Mock; count: jest.Mock }
  $transaction: jest.Mock
}

const patch = (deckId: string, body: unknown) =>
  PATCH(
    new Request(`http://localhost/api/admin/billing/products/${deckId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ deckId }) }
  )

const SELLABLE = {
  released: true,
  isActive: true,
  pricingMode: 'SUBSCRIPTION',
  monthlyPrice: 20000,
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(requireOperator).mockResolvedValue({ ok: true, user: { id: 'op1' } } as never)
  // 트랜잭션 콜백에 같은 mock 클라이언트를 넘긴다
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma))
  // 실제 DB 처럼 기존 행에 변경분을 덮어쓴 결과를 돌려준다
  p.billingDeckProduct.update.mockImplementation(async ({ where, data }) => ({
    ...(await p.billingDeckProduct.findUnique.mock.results.at(-1)?.value),
    id: where.id,
    ...data,
  }))
})

describe('PATCH — 공개/가격/과금 모드', () => {
  it('공개 전환: 저장·감사로그·마케팅 캐시 무효화', async () => {
    p.billingDeckProduct.findUnique.mockResolvedValue({
      id: 'finance',
      ...SELLABLE,
      released: false,
    })
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

  it('Serializable 트랜잭션 안에서 판정·저장한다', async () => {
    p.billingDeckProduct.findUnique.mockResolvedValue({
      id: 'finance',
      ...SELLABLE,
      released: false,
    })
    await patch('finance', { released: true })
    expect(p.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    })
  })

  it('마지막 판매 업무는 준비중으로 바꿀 수 없다', async () => {
    p.billingDeckProduct.findUnique.mockResolvedValue({ id: 'recruiting', ...SELLABLE })
    p.billingDeckProduct.count.mockResolvedValue(0)
    const res = await patch('recruiting', { released: false })
    expect(res.status).toBe(409)
    expect(p.billingDeckProduct.update).not.toHaveBeenCalled()
    expect(p.billingDeckProduct.count.mock.calls[0][0].where).toEqual({
      id: { not: 'recruiting' },
      isActive: true,
      released: true,
      pricingMode: 'SUBSCRIPTION',
    })
  })

  it('마지막 판매 업무는 FREE_BETA 로 바꿀 수 없다', async () => {
    p.billingDeckProduct.findUnique.mockResolvedValue({ id: 'recruiting', ...SELLABLE })
    p.billingDeckProduct.count.mockResolvedValue(0)
    const res = await patch('recruiting', { pricingMode: 'FREE_BETA' })
    expect(res.status).toBe(409)
  })

  it('다른 판매 업무가 있으면 준비중 전환 허용', async () => {
    p.billingDeckProduct.findUnique.mockResolvedValue({ id: 'recruiting', ...SELLABLE })
    p.billingDeckProduct.count.mockResolvedValue(1)
    const res = await patch('recruiting', { released: false })
    expect(res.status).toBe(200)
  })

  it('동시 변경 충돌(P2034)은 409 로 재시도 안내', async () => {
    p.$transaction.mockRejectedValue(Object.assign(new Error('conflict'), { code: 'P2034' }))
    const res = await patch('recruiting', { released: false })
    expect(res.status).toBe(409)
  })

  it('가격 변경도 마케팅 캐시를 무효화한다 (표시가=결제가)', async () => {
    p.billingDeckProduct.findUnique.mockResolvedValue({ id: 'recruiting', ...SELLABLE })
    await patch('recruiting', { monthlyPrice: 30000 })
    expect(invalidateDeckReleaseCache).toHaveBeenCalled()
  })

  it('값이 그대로면 캐시 무효화하지 않는다', async () => {
    p.billingDeckProduct.findUnique.mockResolvedValue({ id: 'recruiting', ...SELLABLE })
    await patch('recruiting', { monthlyPrice: 20000 })
    expect(invalidateDeckReleaseCache).not.toHaveBeenCalled()
  })
})
