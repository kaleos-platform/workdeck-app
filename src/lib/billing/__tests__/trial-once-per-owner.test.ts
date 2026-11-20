/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({ prisma: {} }))

import { ensureTrialStarted, findTrialUsedElsewhere } from '../entitlement'

const db = {
  spaceSubscription: { findUnique: jest.fn() },
  billingDeckProduct: { findUnique: jest.fn() },
  spaceDeckAccess: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    createMany: jest.fn(),
    updateMany: jest.fn(),
  },
}
const run = (opts?: { trialOncePerOwner?: boolean }) =>
  ensureTrialStarted('s-new', 'recruiting', db as never, opts)

beforeEach(() => {
  jest.resetAllMocks()
  db.spaceSubscription.findUnique.mockResolvedValue(null)
  db.billingDeckProduct.findUnique.mockResolvedValue({
    id: 'recruiting',
    isActive: true,
    pricingMode: 'SUBSCRIPTION',
  })
  db.spaceDeckAccess.findUnique.mockResolvedValue(null)
  db.spaceDeckAccess.findMany.mockResolvedValue([])
})

describe('findTrialUsedElsewhere', () => {
  it('이 Space 의 OWNER 가 OWNER 인 다른 Space 의 체험 이력만 찾는다', async () => {
    db.spaceDeckAccess.findMany.mockResolvedValue([
      { deckAppId: 'recruiting' },
      { deckAppId: 'recruiting' },
    ])
    expect(await findTrialUsedElsewhere('s-new', ['recruiting', 'finance'], db as never)).toEqual([
      'recruiting',
    ])
    expect(db.spaceDeckAccess.findMany).toHaveBeenCalledWith({
      where: {
        deckAppId: { in: ['recruiting', 'finance'] },
        trialEndsAt: { not: null },
        space: {
          id: { not: 's-new' },
          members: {
            some: {
              role: 'OWNER',
              user: { spaceMemberships: { some: { spaceId: 's-new', role: 'OWNER' } } },
            },
          },
        },
      },
      select: { deckAppId: true },
    })
  })

  it('업무 목록이 비면 조회하지 않는다', async () => {
    expect(await findTrialUsedElsewhere('s-new', [], db as never)).toEqual([])
    expect(db.spaceDeckAccess.findMany).not.toHaveBeenCalled()
  })
})

describe('ensureTrialStarted 소유자당 1회', () => {
  it('다른 OWNER Space 에 체험 이력이 없으면 체험을 시작한다', async () => {
    await run()
    expect(db.spaceDeckAccess.createMany).toHaveBeenCalledTimes(1)
  })

  it('다른 OWNER Space 에 체험 이력이 있으면 체험을 시작하지 않는다', async () => {
    db.spaceDeckAccess.findMany.mockResolvedValue([{ deckAppId: 'recruiting' }])
    await run()
    expect(db.spaceDeckAccess.createMany).not.toHaveBeenCalled()
    expect(db.spaceDeckAccess.updateMany).not.toHaveBeenCalled()
  })

  it('어드민 옵션 trialOncePerOwner:false 는 이력이 있어도 체험을 시작하고 이력 조회도 안 한다', async () => {
    db.spaceDeckAccess.findMany.mockResolvedValue([{ deckAppId: 'recruiting' }])
    await run({ trialOncePerOwner: false })
    expect(db.spaceDeckAccess.findMany).not.toHaveBeenCalled()
    expect(db.spaceDeckAccess.createMany).toHaveBeenCalledTimes(1)
  })

  it('이 Space 에 이미 체험 기록이 있으면 일찍 반환한다(기존 종료일 유지)', async () => {
    db.spaceDeckAccess.findUnique.mockResolvedValue({ trialEndsAt: new Date() })
    await run()
    expect(db.spaceDeckAccess.createMany).not.toHaveBeenCalled()
  })
})
