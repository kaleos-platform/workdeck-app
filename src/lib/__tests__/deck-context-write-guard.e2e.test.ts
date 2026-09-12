/**
 * resolveDeckContext({ write: true }) 가드 e2e — 실 dev DB.
 * 실행 전제: .env.local(dev DB). 없으면 describe.skip.
 *
 * 검증: 구독 만료(LOCKED) Space 는 write 옵션에서만 402, 조회는 통과. 면제 Space 는 둘 다 통과.
 *
 * 격리: 실 deck('finance' 등)의 pricingMode 를 건드리면 같은 dev DB 를 쓰는 다른 e2e 스위트가
 *       병렬로 깨진다. 그래서 전용 DeckApp/BillingDeckProduct/Space 를 만들고 정리한다.
 */
import { prisma } from '@/lib/prisma'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const DECK_ID = 'e2e-write-guard-deck'
const LOCKED_SPACE = 'e2e00000-0000-4000-8000-0000000000d1'
const EXEMPT_SPACE = 'e2e00000-0000-4000-8000-0000000000d2'
const LOCKED_USER = 'e2e00000-0000-4000-8000-0000000000d3'
const EXEMPT_USER = 'e2e00000-0000-4000-8000-0000000000d4'

// resolveSpaceContext 는 "최고참 멤버십" 하나만 보므로 Space 마다 전용 User 가 필요하다.
let mockUserId: string | null = null
jest.mock('@/hooks/use-user', () => ({
  getUser: async () => (mockUserId ? { id: mockUserId } : null),
}))

// getUser mock 이후에 import 해야 한다.
import { resolveDeckContext } from '@/lib/api-helpers'

d('resolveDeckContext write 가드', () => {
  beforeAll(async () => {
    await prisma.deckApp.upsert({
      where: { id: DECK_ID },
      update: { isActive: true },
      create: { id: DECK_ID, name: 'E2E write 가드 테스트', isActive: true },
    })
    // 유료 전환 60일 경과 → 유예(14일)도 끝나 LOCKED 판정.
    await prisma.billingDeckProduct.upsert({
      where: { id: DECK_ID },
      update: {},
      create: {
        id: DECK_ID,
        name: 'E2E write 가드 테스트',
        pricingMode: 'SUBSCRIPTION',
        monthlyPrice: 10000,
        paidActivatedAt: new Date(Date.now() - 60 * 24 * 3_600_000),
        isActive: true,
      },
    })

    for (const [spaceId, userId] of [
      [LOCKED_SPACE, LOCKED_USER],
      [EXEMPT_SPACE, EXEMPT_USER],
    ]) {
      await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: { id: userId, email: `e2e-write-guard-${userId.slice(-2)}@throwaway.test` },
      })
      await prisma.space.upsert({
        where: { id: spaceId },
        update: {},
        create: { id: spaceId, name: `E2E write 가드 ${spaceId.slice(-2)}`, type: 'PERSONAL' },
      })
      await prisma.spaceMember.upsert({
        where: { spaceId_userId: { spaceId, userId } },
        update: {},
        create: { spaceId, userId, role: 'OWNER' },
      })
      await prisma.deckInstance.upsert({
        where: { spaceId_deckAppId: { spaceId, deckAppId: DECK_ID } },
        update: { isActive: true },
        create: { spaceId, deckAppId: DECK_ID, isActive: true },
      })
    }

    // LOCKED_SPACE 는 구독 행 자체가 없다 → 면제·구독·Trial·유예 전부 미해당 → LOCKED.
    await prisma.spaceSubscription.upsert({
      where: { spaceId: EXEMPT_SPACE },
      update: { exemptFlag: true },
      create: { spaceId: EXEMPT_SPACE, status: 'EXPIRED', exemptFlag: true },
    })
  })

  afterAll(async () => {
    const spaceIds = [LOCKED_SPACE, EXEMPT_SPACE]
    await prisma.spaceSubscription.deleteMany({ where: { spaceId: { in: spaceIds } } })
    await prisma.deckInstance.deleteMany({ where: { spaceId: { in: spaceIds } } })
    await prisma.spaceMember.deleteMany({ where: { spaceId: { in: spaceIds } } })
    await prisma.space.deleteMany({ where: { id: { in: spaceIds } } })
    await prisma.user.deleteMany({ where: { id: { in: [LOCKED_USER, EXEMPT_USER] } } })
    await prisma.billingDeckProduct.deleteMany({ where: { id: DECK_ID } })
    await prisma.deckApp.deleteMany({ where: { id: DECK_ID } })
    await prisma.$disconnect()
  })

  test('LOCKED Space — 조회는 통과, write 만 402', async () => {
    mockUserId = LOCKED_USER

    const read = await resolveDeckContext(DECK_ID)
    expect('error' in read).toBe(false)

    const write = await resolveDeckContext(DECK_ID, { write: true })
    const error = 'error' in write ? write.error : undefined
    if (!error) throw new Error('write 요청이 차단되지 않았다')
    expect(error.status).toBe(402)
    await expect(error.json()).resolves.toMatchObject({
      message: '구독이 만료되어 조회만 가능합니다',
    })
  })

  test('면제 Space — 조회·write 모두 통과', async () => {
    mockUserId = EXEMPT_USER

    expect('error' in (await resolveDeckContext(DECK_ID))).toBe(false)
    expect('error' in (await resolveDeckContext(DECK_ID, { write: true }))).toBe(false)
  })
})
