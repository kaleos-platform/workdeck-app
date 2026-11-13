/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import { resolveSpaceContext } from '@/lib/api-helpers'
import { resolveEntitlement } from '@/lib/billing/entitlement'
import { findClosedDecks } from '@/lib/billing/deck-release'
import { GET } from '../route'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    billingDeckProduct: { findMany: jest.fn() },
    spaceSubscription: { findUnique: jest.fn() },
    billingMethod: { findFirst: jest.fn() },
    billingCharge: { findMany: jest.fn() },
    subscriptionItem: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/api-helpers', () => ({
  ...jest.requireActual('@/lib/api-helpers'),
  resolveSpaceContext: jest.fn(),
}))
jest.mock('@/lib/billing/entitlement', () => ({ resolveEntitlement: jest.fn() }))
jest.mock('@/lib/billing/deck-release', () => ({ findClosedDecks: jest.fn() }))

const p = prisma as unknown as Record<string, Record<string, jest.Mock>>

it('준비중·미설치 업무는 comingSoon=true 로 내려간다', async () => {
  jest.mocked(resolveSpaceContext).mockResolvedValue({
    space: { id: 's1' },
    role: 'OWNER',
  } as never)
  p.billingDeckProduct.findMany.mockResolvedValue([
    { id: 'recruiting', monthlyPrice: 20000, released: true },
    { id: 'finance', monthlyPrice: 40000, released: false },
  ])
  p.spaceSubscription.findUnique.mockResolvedValue(null)
  p.billingMethod.findFirst.mockResolvedValue(null)
  p.billingCharge.findMany.mockResolvedValue([])
  p.subscriptionItem.findMany.mockResolvedValue([])
  jest.mocked(resolveEntitlement).mockResolvedValue({ decks: {} } as never)
  jest.mocked(findClosedDecks).mockResolvedValue(['finance'])

  const json = await (await GET())!.json()
  expect(findClosedDecks).toHaveBeenCalledWith('s1', ['recruiting', 'finance'])
  expect(
    json.products.map((x: { id: string; comingSoon: boolean }) => [x.id, x.comingSoon])
  ).toEqual([
    ['recruiting', false],
    ['finance', true],
  ])
})
