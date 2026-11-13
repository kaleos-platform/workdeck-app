/** @jest-environment node */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveSpaceContext } from '@/lib/api-helpers'
import { canUseDeck, ensureTrialStarted } from '@/lib/billing/entitlement'
import { findClosedDecks } from '@/lib/billing/deck-release'
import { POST } from '../route'

jest.mock('@/lib/prisma', () => ({
  prisma: {
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
    expect(res.status).toBe(403)
    expect(findClosedDecks).toHaveBeenCalledWith('s1', ['finance'])
    expect(ensureTrialStarted).not.toHaveBeenCalled()
    expect(p.deckInstance.create).not.toHaveBeenCalled()
  })

  it('열린 업무는 추가된다', async () => {
    jest.mocked(findClosedDecks).mockResolvedValue([])
    const res = (await POST(req('finance')))!
    expect(res.status).toBe(201)
  })
})
