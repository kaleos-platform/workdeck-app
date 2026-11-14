/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import { findClosedDecks } from '../deck-release'
import { addDeck, startSubscription } from '../subscription-service'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    billingMethod: { findFirst: jest.fn() },
    billingDeckProduct: { findMany: jest.fn() },
    spaceDeckAccess: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    spaceSubscription: { findUnique: jest.fn() },
  },
}))
jest.mock('../providers/toss', () => ({ getBillingProvider: jest.fn() }))
jest.mock('../deck-release', () => ({ findClosedDecks: jest.fn() }))

const mock = prisma as unknown as {
  billingMethod: { findFirst: jest.Mock }
  billingDeckProduct: { findMany: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()
  mock.billingDeckProduct.findMany.mockResolvedValue([
    { id: 'finance', isActive: true, pricingMode: 'SUBSCRIPTION', monthlyPrice: 1000 },
  ])
  // 가드를 통과하면 결제수단 로드에서 멈춘다
  mock.billingMethod.findFirst.mockResolvedValue(null)
})

describe('구독 서비스 — 준비중 업무 가드', () => {
  it('startSubscription: 준비중·미설치 업무는 결제 전에 403', async () => {
    jest.mocked(findClosedDecks).mockResolvedValue(['finance'])
    await expect(startSubscription('s1', ['finance'])).rejects.toMatchObject({ status: 403 })
    expect(findClosedDecks).toHaveBeenCalledWith('s1', ['finance'])
    expect(mock.billingMethod.findFirst).not.toHaveBeenCalled()
  })

  it('addDeck: 준비중·미설치 업무는 403', async () => {
    jest.mocked(findClosedDecks).mockResolvedValue(['finance'])
    await expect(addDeck('s1', 'finance')).rejects.toMatchObject({ status: 403 })
  })

  it('열린 업무(공개 또는 기존 설치)는 다음 단계로 진행', async () => {
    jest.mocked(findClosedDecks).mockResolvedValue([])
    await expect(addDeck('s1', 'finance')).rejects.toThrow('등록된 결제수단이 없습니다')
  })
})
