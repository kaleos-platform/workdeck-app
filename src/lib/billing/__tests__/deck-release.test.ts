/** @jest-environment node */
jest.mock('server-only', () => ({}))
jest.mock('next/cache', () => ({
  unstable_cache: (loader: () => unknown) => loader,
  revalidateTag: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    billingDeckProduct: { findMany: jest.fn() },
    deckInstance: { findMany: jest.fn() },
    subscriptionItem: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  findClosedDecks,
  getReleasedDeckIds,
  isDeckReleased,
  RELEASE_FALLBACK_DECK_IDS,
} from '../deck-release'

const p = prisma as unknown as {
  billingDeckProduct: { findMany: jest.Mock }
  deckInstance: { findMany: jest.Mock }
  subscriptionItem: { findMany: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()
  p.billingDeckProduct.findMany.mockResolvedValue([
    { id: 'recruiting', released: true },
    { id: 'finance', released: false },
    { id: 'seller-hub', released: false },
  ])
  p.deckInstance.findMany.mockResolvedValue([])
  p.subscriptionItem.findMany.mockResolvedValue([])
})

describe('isDeckReleased', () => {
  it('released=true 만 공개', () => {
    expect(isDeckReleased({ released: true })).toBe(true)
    expect(isDeckReleased({ released: false })).toBe(false)
  })
  it('과금 상품 행이 없으면 준비중', () => {
    expect(isDeckReleased(null)).toBe(false)
    expect(isDeckReleased(undefined)).toBe(false)
  })
})

describe('findClosedDecks', () => {
  it('준비중 + 미설치 업무만 막는다', async () => {
    await expect(findClosedDecks('s1', ['recruiting', 'finance'])).resolves.toEqual(['finance'])
  })

  it('과금 상품 행이 없는 업무도 막는다', async () => {
    await expect(findClosedDecks('s1', ['unknown'])).resolves.toEqual(['unknown'])
  })

  it('DeckInstance 가 있으면(비활성 포함) 준비중이어도 연다', async () => {
    p.deckInstance.findMany.mockResolvedValue([{ deckAppId: 'finance' }])
    await expect(findClosedDecks('s1', ['finance', 'seller-hub'])).resolves.toEqual(['seller-hub'])
    expect(p.deckInstance.findMany.mock.calls[0][0].where).not.toHaveProperty('isActive')
  })

  it('끝나지 않은 구독 아이템이 있으면 연다', async () => {
    p.subscriptionItem.findMany.mockResolvedValue([{ deckAppId: 'seller-hub' }])
    await expect(findClosedDecks('s1', ['seller-hub'])).resolves.toEqual([])
  })

  it('빈 목록은 조회 없이 빈 결과', async () => {
    await expect(findClosedDecks('s1', [])).resolves.toEqual([])
    expect(p.billingDeckProduct.findMany).not.toHaveBeenCalled()
  })
})

describe('getReleasedDeckIds', () => {
  it('DB 의 공개 업무 목록', async () => {
    await expect(getReleasedDeckIds()).resolves.toEqual(['recruiting'])
  })

  it('DB 조회 실패 시 기본값(모집 관리만) 으로 안전하게 폴백', async () => {
    p.billingDeckProduct.findMany.mockRejectedValue(new Error('db down'))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(getReleasedDeckIds()).resolves.toEqual(RELEASE_FALLBACK_DECK_IDS)
    expect(RELEASE_FALLBACK_DECK_IDS).toEqual(['recruiting'])
  })
})
