/** @jest-environment node */
// approveAndExecute autoGate — 게이트 트랜잭션 안에서 scope·부여자·토큰·결정자 소속/역할을 다시 확인한다. 안 맞으면 전이하지 않는다.
import { prisma } from '@/lib/prisma'
import { approveAndExecute } from '../execute'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    agentPendingAction: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    spaceAgent: { findFirst: jest.fn() },
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
const isExternalAction = jest.fn().mockReturnValue(false)
jest.mock('../decision-policy', () => ({
  deciderDenial: jest.fn().mockResolvedValue(null),
  needsWebReview: () => false,
  isExternalAction: (...a: unknown[]) => isExternalAction(...a),
  requiredDecisionRole: jest.fn().mockResolvedValue('ADMIN'),
  WEB_REVIEW_REQUIRED: 'x',
}))
const execute = jest.fn().mockResolvedValue({ planId: 'pl1' })
jest.mock('../registry', () => ({
  getActionDefinition: () => ({ paramsSchema: { parse: (v: unknown) => v }, execute }),
}))

const p = prisma as unknown as {
  agentPendingAction: { findUnique: jest.Mock; updateMany: jest.Mock; update: jest.Mock }
  spaceAgent: { findFirst: jest.Mock }
  $transaction: jest.Mock
}
const tx = { $queryRaw: jest.fn(), agentPendingAction: { updateMany: jest.fn() } }
const agentGate = {
  autoGate: {
    kind: 'agent' as const,
    agentId: 'ag1',
    tokenId: 'tok1',
    requiredScope: 'sellerhub:write',
  },
}
const integrationGate = {
  autoGate: { kind: 'integration' as const, agentId: 'ag1', requiredScope: 'sellerhub:write' },
}
const okAgent = {
  status: 'ACTIVE',
  scopes: ['sellerhub:write'],
  writeGrants: { 'sellerhub:write': { userId: 'admin1', at: '2026-11-20T00:00:00Z' } },
}
const okToken = { revokedAt: null, expiresAt: null }
const okMember = { role: 'ADMIN' }

// 쿼리 순서: 에이전트 행 → (agent 만) 토큰 행 → SpaceMember 행
function setup(agent: unknown, token: unknown, member: unknown = okMember, kind = 'agent') {
  tx.$queryRaw.mockResolvedValueOnce(agent ? [agent] : [])
  if (kind === 'agent') tx.$queryRaw.mockResolvedValueOnce(token ? [token] : [])
  tx.$queryRaw.mockResolvedValueOnce(member ? [member] : [])
}

beforeEach(() => {
  jest.clearAllMocks()
  isExternalAction.mockReturnValue(false)
  p.agentPendingAction.findUnique.mockReset()
  tx.$queryRaw.mockReset()
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
  p.spaceAgent.findFirst.mockResolvedValue({ name: '에밀리' })
})

test('조건이 맞으면 트랜잭션 안에서 전이하고 실행한다', async () => {
  setup(okAgent, okToken)
  const r = await approveAndExecute('a1', 'admin1', agentGate)
  expect(r).toMatchObject({ ok: true, status: 'EXECUTED' })
  expect(tx.agentPendingAction.updateMany).toHaveBeenCalled()
  expect(p.agentPendingAction.updateMany).not.toHaveBeenCalled()
  // 에이전트·토큰·결정자 SpaceMember 행을 모두 FOR UPDATE 로 잠근다
  expect(tx.$queryRaw.mock.calls).toHaveLength(3)
  for (const c of tx.$queryRaw.mock.calls) expect(String(c[0])).toContain('FOR UPDATE')
  expect(String(tx.$queryRaw.mock.calls[2][0])).toContain('SpaceMember')
  // 자동 실행 표시 — 전이에 autoExecuted, 실행 ctx 에 autoExecuted·actorName
  expect(tx.agentPendingAction.updateMany.mock.calls[0][0].data).toMatchObject({
    status: 'APPROVED',
    autoExecuted: true,
  })
  expect(execute.mock.calls[0][0]).toMatchObject({ autoExecuted: true, actorName: '에밀리' })
})

test.each([
  ['쓰기 scope 회수', { ...okAgent, scopes: ['sellerhub:read'] }, okToken, okMember],
  [
    '부여자가 다름',
    { ...okAgent, writeGrants: { 'sellerhub:write': { userId: 'other' } } },
    okToken,
    okMember,
  ],
  ['부여자 기록 없음', { ...okAgent, writeGrants: {} }, okToken, okMember],
  ['에이전트 비활성', { ...okAgent, status: 'DISABLED' }, okToken, okMember],
  ['토큰 폐기', okAgent, { revokedAt: new Date(), expiresAt: null }, okMember],
  ['토큰 만료', okAgent, { revokedAt: null, expiresAt: new Date(Date.now() - 1000) }, okMember],
  ['토큰 없음', okAgent, null, okMember],
  ['결정자 구성원 제거', okAgent, okToken, null],
  ['결정자 ADMIN → MEMBER 강등', okAgent, okToken, { role: 'MEMBER' }],
])('agent %s → BLOCKED, 전이·실행 없음', async (_n, agent, token, member) => {
  setup(agent, token, member)
  const r = await approveAndExecute('a1', 'admin1', agentGate)
  expect(r).toMatchObject({ ok: false, status: 'BLOCKED' })
  expect(tx.agentPendingAction.updateMany).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

test('integration: 토큰·부여자 대조 없이 에이전트 ACTIVE·scope·결정자 역할만 본다', async () => {
  setup({ ...okAgent, writeGrants: {} }, null, okMember, 'integration')
  const r = await approveAndExecute('a1', 'member1', integrationGate)
  expect(r).toMatchObject({ ok: true, status: 'EXECUTED' })
  expect(tx.$queryRaw).toHaveBeenCalledTimes(2)
})

test.each([
  ['scope 회수', { ...okAgent, scopes: [] }, okMember],
  ['에이전트 비활성', { ...okAgent, status: 'DISABLED' }, okMember],
  ['결정자 강등', okAgent, { role: 'MEMBER' }],
  ['결정자 제거', okAgent, null],
])('integration %s → BLOCKED', async (_n, agent, member) => {
  setup(agent, null, member, 'integration')
  const r = await approveAndExecute('a1', 'member1', integrationGate)
  expect(r).toMatchObject({ ok: false, status: 'BLOCKED' })
  expect(tx.agentPendingAction.updateMany).not.toHaveBeenCalled()
})

const userGate = { autoGate: { kind: 'user' as const, requiredScope: 'sellerhub:write' } }

test('user: 에이전트·토큰 행 없이 결정자 SpaceMember 행만 잠그고 소속·역할을 확인해 실행', async () => {
  tx.$queryRaw.mockResolvedValueOnce([okMember])
  const r = await approveAndExecute('a1', 'member1', userGate)
  expect(r).toMatchObject({ ok: true, status: 'EXECUTED' })
  expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
  expect(String(tx.$queryRaw.mock.calls[0][0])).toContain('SpaceMember')
  expect(String(tx.$queryRaw.mock.calls[0][0])).toContain('FOR UPDATE')
})

test.each([
  ['결정자 제거', null],
  ['MEMBER 역할(ADMIN 필요)', { role: 'MEMBER' }],
])('user %s → BLOCKED', async (_n, member) => {
  tx.$queryRaw.mockResolvedValueOnce(member ? [member] : [])
  const r = await approveAndExecute('a1', 'member1', userGate)
  expect(r).toMatchObject({ ok: false, status: 'BLOCKED' })
  expect(tx.agentPendingAction.updateMany).not.toHaveBeenCalled()
})

test('외부 반영 액션은 autoGate 로도 전이하지 않는다', async () => {
  isExternalAction.mockReturnValue(true)
  const r = await approveAndExecute('a1', 'admin1', agentGate)
  expect(r).toMatchObject({ ok: false, status: 'BLOCKED' })
  expect(p.$transaction).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

test('autoGate 없으면 기존처럼 트랜잭션 없이 전이한다', async () => {
  p.agentPendingAction.updateMany.mockResolvedValue({ count: 1 })
  const r = await approveAndExecute('a1', 'admin1')
  expect(r).toMatchObject({ ok: true })
  expect(p.$transaction).not.toHaveBeenCalled()
  expect(p.agentPendingAction.updateMany.mock.calls[0][0].data).not.toHaveProperty('autoExecuted')
  expect(execute.mock.calls[0][0]).not.toHaveProperty('autoExecuted')
})
