/** @jest-environment node */
// createPendingAction 의 idempotencyKey 조회는 Space 경계 안에서만 — 다른 Space 의 액션을 돌려주지 않는다.
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '../create'

jest.mock('@/lib/prisma', () => ({
  prisma: { agentPendingAction: { findUnique: jest.fn(), create: jest.fn() } },
}))
jest.mock('@/lib/billing/entitlement', () => ({
  assertDeckWritable: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/domain', () => ({ buildAppUrl: (p: string) => `https://app.test${p}` }))
jest.mock('@/lib/slack/notify-pending-action', () => ({ notifyPendingAction: jest.fn() }))
jest.mock('../registry', () => ({
  getActionDefinition: () => ({ deckKey: 'seller-hub', paramsSchema: z.object({}) }),
}))

const action = prisma.agentPendingAction as unknown as { findUnique: jest.Mock; create: jest.Mock }
const draft = {
  spaceId: 'space-a',
  actionType: 'test.action',
  params: {},
  summary: 's',
  source: 'SYSTEM' as const,
  requestedBy: 'worker',
  idempotencyKey: 'k1',
}
const expiresAt = new Date('2026-10-13T00:00:00Z')

beforeEach(() => jest.clearAllMocks())

test('같은 Space 의 기존 키 → 기존 액션 반환', async () => {
  action.findUnique.mockResolvedValue({ id: 'a1', spaceId: 'space-a', expiresAt })
  const res = await createPendingAction(draft)
  expect(res.actionId).toBe('a1')
  expect(action.create).not.toHaveBeenCalled()
})

test('다른 Space 가 쓴 키 → 거부, 그 액션을 돌려주지 않는다', async () => {
  action.findUnique.mockResolvedValue({ id: 'b1', spaceId: 'space-b', expiresAt })
  await expect(createPendingAction(draft)).rejects.toThrow('idempotencyKey')
  expect(action.create).not.toHaveBeenCalled()
})

test('생성 경합(P2002) 승자가 다른 Space → 거부', async () => {
  action.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: 'b1', spaceId: 'space-b', expiresAt })
  action.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
  await expect(createPendingAction(draft)).rejects.toThrow('idempotencyKey')
})

test('생성 경합(P2002) 승자가 같은 Space → 승자 반환', async () => {
  action.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: 'a2', spaceId: 'space-a', expiresAt })
  action.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
  expect((await createPendingAction(draft)).actionId).toBe('a2')
})
