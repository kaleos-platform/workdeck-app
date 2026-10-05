/**
 * 승인 만료 게이트 e2e — 실 dev DB.
 *
 * 검증: 이미 만료된(expiresAt 과거) PENDING 액션은 승인 게이트를 통과하지 못하고
 *       EXPIRED로 응답하며, DB 상태도 APPROVED로 전이하지 않는다.
 */
// @jest-environment node
import { prisma } from '@/lib/prisma'
import { approveAndExecute } from '../execute'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000b1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000b2'

d('승인 만료 게이트', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-agent-expiry@throwaway.test', name: 'E2E Agent Expiry' },
    })
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E Agent Expiry Throwaway', type: 'PERSONAL' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_ID, userId: USER_ID } },
      update: {},
      create: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' },
    })
  })

  afterEach(async () => {
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: SPACE_ID } })
  })

  afterAll(async () => {
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.spaceMember.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: SPACE_ID } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
    await prisma.$disconnect()
  })

  test('만료된 PENDING 액션은 승인되지 않는다', async () => {
    const action = await prisma.agentPendingAction.create({
      data: {
        spaceId: SPACE_ID,
        deckKey: 'finance',
        actionType: 'finance.transaction.reclassify',
        payload: { transactionId: 'x', categoryId: 'y' },
        summary: '테스트',
        source: 'WEB',
        requestedBy: USER_ID,
        expiresAt: new Date(Date.now() - 60_000), // 1분 전 만료
      },
    })

    const res = await approveAndExecute(action.id, USER_ID)

    expect(res.ok).toBe(false)
    expect(res.status).toBe('EXPIRED')

    const after = await prisma.agentPendingAction.findUnique({ where: { id: action.id } })
    expect(after?.status).toBe('PENDING') // APPROVED 로 넘어가지 않았다
  })
})
