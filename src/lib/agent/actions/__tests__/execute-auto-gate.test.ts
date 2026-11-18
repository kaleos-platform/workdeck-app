/** @jest-environment node */
// approveAndExecute autoGate — 게이트 트랜잭션 안에서 스위치·토큰을 다시 확인한다. 안 맞으면 전이하지 않는다.
import { prisma } from '@/lib/prisma'
import { approveAndExecute } from '../execute'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    agentPendingAction: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/lib/billing/entitlement', () => ({
  assertDeckWritable: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/agent/audit', () => ({
  startToolAudit: jest.fn().mockResolvedValue('aud1'),
  finishToolAudit: jest.fn(),
  maskSecrets: (s: string) => s,
}))
jest.mock('../decision-policy', () => ({
  deciderDenial: jest.fn().mockResolvedValue(null),
  needsWebReview: () => false,
  WEB_REVIEW_REQUIRED: 'x',
}))
const execute = jest.fn().mockResolvedValue({ planId: 'pl1' })
jest.mock('../registry', () => ({
  getActionDefinition: () => ({ paramsSchema: { parse: (v: unknown) => v }, execute }),
}))

const p = prisma as unknown as {
  agentPendingAction: { findUnique: jest.Mock; updateMany: jest.Mock; update: jest.Mock }
  $transaction: jest.Mock
}
const tx = { $queryRaw: jest.fn(), agentPendingAction: { updateMany: jest.fn() } }
const gateOpts = { autoGate: { agentId: 'ag1', tokenId: 'tok1' } }
const okAgent = { status: 'ACTIVE', autoExecuteDrafts: true, autoExecuteEnabledById: 'admin1' }
const okToken = { revokedAt: null, expiresAt: null }

function setup(agent: unknown, token: unknown) {
  tx.$queryRaw
    .mockResolvedValueOnce(agent ? [agent] : [])
    .mockResolvedValueOnce(token ? [token] : [])
}

beforeEach(() => {
  jest.clearAllMocks()
  p.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx))
  tx.agentPendingAction.updateMany.mockResolvedValue({ count: 1 })
  p.agentPendingAction.findUnique
    .mockResolvedValueOnce({
      status: 'PENDING',
      spaceId: 'sp1',
      deckKey: 'd',
      actionType: 't',
      payload: {},
    })
    .mockResolvedValueOnce({
      actionType: 't',
      spaceId: 'sp1',
      actorType: 'agent',
      actorId: 'ag1',
      actorTokenId: 'tok1',
      requesterUserId: null,
      workId: 'w',
      payload: {},
    })
  p.agentPendingAction.update.mockResolvedValue({})
})

test('조건이 맞으면 트랜잭션 안에서 전이하고 실행한다', async () => {
  setup(okAgent, okToken)
  const r = await approveAndExecute('a1', 'admin1', gateOpts)
  expect(r).toMatchObject({ ok: true, status: 'EXECUTED' })
  expect(tx.agentPendingAction.updateMany).toHaveBeenCalled()
  expect(p.agentPendingAction.updateMany).not.toHaveBeenCalled()
  expect(String(tx.$queryRaw.mock.calls[0][0])).toContain('FOR UPDATE')
})

test.each([
  ['스위치 꺼짐', { ...okAgent, autoExecuteDrafts: false }, okToken],
  ['켠 사람이 다름', { ...okAgent, autoExecuteEnabledById: 'other' }, okToken],
  ['에이전트 비활성', { ...okAgent, status: 'DISABLED' }, okToken],
  ['토큰 폐기', okAgent, { revokedAt: new Date(), expiresAt: null }],
  ['토큰 만료', okAgent, { revokedAt: null, expiresAt: new Date(Date.now() - 1000) }],
  ['토큰 없음', okAgent, null],
])('%s → BLOCKED, 전이·실행 없음', async (_n, agent, token) => {
  setup(agent, token)
  const r = await approveAndExecute('a1', 'admin1', gateOpts)
  expect(r).toMatchObject({ ok: false, status: 'BLOCKED' })
  expect(tx.agentPendingAction.updateMany).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

test('autoGate 없으면 기존처럼 트랜잭션 없이 전이한다', async () => {
  p.agentPendingAction.updateMany.mockResolvedValue({ count: 1 })
  const r = await approveAndExecute('a1', 'admin1')
  expect(r).toMatchObject({ ok: true })
  expect(p.$transaction).not.toHaveBeenCalled()
})
