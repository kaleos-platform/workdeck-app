/**
 * 사용자 새 작업 공간 만들기 — 실 DB(dev) 경합 e2e. PRISMA_POOL_MAX=1 로 돌려
 * tx 안에서 전역 prisma 를 쓰면(풀 고갈 데드락) 바로 드러나게 한다.
 *
 *  ① 같은 OWNER 의 두 Space 에서 같은 업무를 동시에 켜면 체험은 정확히 1건, 다른 쪽은 DECK_SUBSCRIPTION_REQUIRED
 *  ② 소유 4개 상태에서 동시에 2건 생성 → 정확히 1건 성공
 *  ③ 생성과 업무 켜기가 동시에 와도 데드락·timeout 없이 끝난다
 *
 * throwaway user/space 를 시드하고 afterAll 에서 지운다. recruiting 과금 상품은 테스트 동안만
 * SUBSCRIPTION 으로 바꾸고 원래 값으로 복원한다. DB URL 이 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

jest.mock('server-only', () => ({}))
jest.mock('@/lib/billing/deck-release', () => ({ findClosedDecks: async () => [] }))

import { prisma } from '@/lib/prisma'
import { createOwnedSpaceInTx, MAX_OWNED_SPACES } from '@/lib/spaces/create-owned-space'
import { EnableDeckError, enableDeckInTx } from '@/lib/spaces/enable-deck'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

const U1 = 'e2e00000-0000-4000-8000-00000000c501'
const U2 = 'e2e00000-0000-4000-8000-00000000c502'
const U3 = 'e2e00000-0000-4000-8000-00000000c503'
const USERS = [U1, U2, U3]
const DECK = 'recruiting'

let originalMode: 'FREE_BETA' | 'SUBSCRIPTION' | null = null

async function cleanup() {
  const members = await prisma.spaceMember.findMany({ where: { userId: { in: USERS } } })
  const spaceIds = [...new Set(members.map((m) => m.spaceId))]
  await prisma.spaceMember.deleteMany({ where: { userId: { in: USERS } } })
  if (spaceIds.length > 0) {
    await prisma.deckInstance.deleteMany({ where: { spaceId: { in: spaceIds } } })
    await prisma.spaceDeckAccess.deleteMany({ where: { spaceId: { in: spaceIds } } })
    await prisma.space.deleteMany({ where: { id: { in: spaceIds } } })
  }
  await prisma.user.deleteMany({ where: { id: { in: USERS } } })
}

const mkUser = (id: string) =>
  prisma.user.create({ data: { id, email: `${id}@e2e-create-space.example.com` } })
const mkSpace = (userId: string, name: string) =>
  prisma.space.create({
    data: { name, type: 'PERSONAL', members: { create: { userId, role: 'OWNER' } } },
    select: { id: true },
  })
const enable = (spaceId: string) => prisma.$transaction((tx) => enableDeckInTx(tx, spaceId, DECK))
const create = (userId: string, name: string) =>
  prisma.$transaction((tx) =>
    createOwnedSpaceInTx(tx, { userId, name, maxOwned: MAX_OWNED_SPACES })
  )

d('user-create-space 실 DB 경합', () => {
  beforeAll(async () => {
    await cleanup()
    const product = await prisma.billingDeckProduct.findUnique({ where: { id: DECK } })
    originalMode = product?.pricingMode ?? null
    await prisma.billingDeckProduct.update({
      where: { id: DECK },
      data: { pricingMode: 'SUBSCRIPTION' },
    })
  })

  afterAll(async () => {
    await cleanup()
    if (originalMode) {
      await prisma.billingDeckProduct.update({
        where: { id: DECK },
        data: { pricingMode: originalMode },
      })
    }
    await prisma.$disconnect()
  })

  beforeEach(cleanup)

  it('① 같은 OWNER 의 두 Space 에서 동시에 같은 업무를 켜면 체험 1건, 나머지는 구독 필요', async () => {
    await mkUser(U1)
    const a = await mkSpace(U1, 'e2e-a')
    const b = await mkSpace(U1, 'e2e-b')

    const results = await Promise.allSettled([enable(a.id), enable(b.id)])

    const ok = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(ok).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(EnableDeckError)
    expect((rejected[0].reason as EnableDeckError).code).toBe('DECK_SUBSCRIPTION_REQUIRED')

    const trials = await prisma.spaceDeckAccess.findMany({
      where: { spaceId: { in: [a.id, b.id] }, deckAppId: DECK, trialEndsAt: { not: null } },
    })
    expect(trials).toHaveLength(1)
  })

  it('② 소유 4개에서 동시에 2건 생성하면 정확히 1건 성공, 나머지는 limitReached', async () => {
    await mkUser(U2)
    for (let i = 0; i < 4; i++) await mkSpace(U2, `e2e-own-${i}`)

    const results = await Promise.all([create(U2, 'e2e-new-1'), create(U2, 'e2e-new-2')])

    expect(results.filter((r) => 'space' in r)).toHaveLength(1)
    expect(results.filter((r) => 'limitReached' in r)).toHaveLength(1)
    expect(await prisma.spaceMember.count({ where: { userId: U2, role: 'OWNER' } })).toBe(5)
  })

  it('③ 생성과 업무 켜기가 동시에 와도 데드락 없이 끝난다', async () => {
    await mkUser(U3)
    const a = await mkSpace(U3, 'e2e-a')

    const results = await Promise.allSettled([
      create(U3, 'e2e-new'),
      enable(a.id),
      create(U3, 'e2e-new-2'),
    ])

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    expect(await prisma.spaceMember.count({ where: { userId: U3, role: 'OWNER' } })).toBe(3)
    expect(await prisma.deckInstance.count({ where: { spaceId: a.id, isActive: true } })).toBe(1)
  })
})
