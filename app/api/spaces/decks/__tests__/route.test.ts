/** @jest-environment node */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveSpaceContext } from '@/lib/api-helpers'
import { canUseDeck, ensureTrialStarted } from '@/lib/billing/entitlement'
import { findClosedDecks } from '@/lib/billing/deck-release'
import { POST } from '../route'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    deckApp: { findUnique: jest.fn() },
    billingDeckProduct: { findUnique: jest.fn() },
    deckInstance: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}))
jest.mock('@/lib/api-helpers', () => ({
  ...jest.requireActual('@/lib/api-helpers'),
  resolveSpaceContext: jest.fn(),
}))
jest.mock('@/lib/billing/entitlement', () => ({
  canUseDeck: jest.fn(),
  ensureTrialStarted: jest.fn(),
}))
jest.mock('@/lib/billing/deck-release', () => ({ findClosedDecks: jest.fn() }))
jest.mock('@/lib/finance/kifrs-seed', () => ({
  seedFinanceCategories: jest.fn(),
  ensureFinanceSeeded: jest.fn(),
}))

const p = prisma as unknown as {
  deckApp: { findUnique: jest.Mock }
  billingDeckProduct: { findUnique: jest.Mock }
  deckInstance: { findUnique: jest.Mock; create: jest.Mock }
}

const req = (deckAppId: string) =>
  new NextRequest('http://localhost/api/spaces/decks', {
    method: 'POST',
    body: JSON.stringify({ deckAppId }),
  })

beforeEach(() => {
  jest.clearAllMocks()
  jest
    .mocked(prisma.$transaction)
    .mockImplementation(async (fn) =>
      (fn as unknown as (tx: typeof prisma) => Promise<unknown>)(prisma)
    )
  jest.mocked(resolveSpaceContext).mockResolvedValue({ space: { id: 's1' } } as never)
  p.deckApp.findUnique.mockResolvedValue({ id: 'finance', name: '재무 관리', isActive: true })
  p.billingDeckProduct.findUnique.mockResolvedValue({
    id: 'finance',
    isActive: true,
    pricingMode: 'SUBSCRIPTION',
  })
  jest.mocked(canUseDeck).mockResolvedValue(true)
  p.deckInstance.findUnique.mockResolvedValue(null)
  p.deckInstance.create.mockResolvedValue({ id: 'i1', deckAppId: 'finance', isActive: true })
})

describe('POST /api/spaces/decks — 준비중 가드', () => {
  it('준비중·미설치 업무는 403, Trial 도 시작하지 않는다', async () => {
    jest.mocked(findClosedDecks).mockResolvedValue(['finance'])
    const res = (await POST(req('finance')))!
    expect(res?.status).toBe(403)
    expect(findClosedDecks).toHaveBeenCalledWith('s1', ['finance'])
    expect(ensureTrialStarted).not.toHaveBeenCalled()
    expect(p.deckInstance.create).not.toHaveBeenCalled()
  })

  it('열린 업무는 추가된다', async () => {
    jest.mocked(findClosedDecks).mockResolvedValue([])
    const res = (await POST(req('finance')))!
    expect(res?.status).toBe(201)
  })
  it('업무 추가 실패는 500으로 반환하고 체험 생성도 설치 transaction 안에서 수행한다', async () => {
    jest.mocked(findClosedDecks).mockResolvedValue([])
    p.deckInstance.create.mockRejectedValueOnce(new Error('write failed'))
    const res = await POST(req('finance'))
    expect(res?.status).toBe(500)
    expect(ensureTrialStarted).toHaveBeenCalledWith('s1', 'finance', prisma)
  })
  it('체험이 만료된 업무는 402이고 설치하지 않는다', async () => {
    jest.mocked(findClosedDecks).mockResolvedValue([])
    jest.mocked(canUseDeck).mockResolvedValueOnce(false)
    const res = await POST(req('finance'))
    expect(res?.status).toBe(402)
    expect(p.deckInstance.create).not.toHaveBeenCalled()
  })
})
