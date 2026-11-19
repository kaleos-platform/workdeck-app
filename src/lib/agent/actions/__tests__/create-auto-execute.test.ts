/** @jest-environment node */
// createPendingAction — 「쓰기 권한 바로 실행」: 내부(external 아님) 액션을 쓰기 scope + 부여자 기록(agent)·인증 구성원(integration)이 있을 때만 승인 없이 실행한다.
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { notifyPendingAction } from '@/lib/slack/notify-pending-action'
import { notifyAutoExecuted, resolveApprovalsTarget } from '@/lib/slack/notify-auto-executed'
import { createPendingAction } from '../create'
import { approveAndExecute } from '../execute'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    agentPendingAction: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    spaceAgent: { findFirst: jest.fn() },
  },
}))
jest.mock('@/lib/billing/entitlement', () => ({
  assertDeckWritable: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/domain', () => ({ buildAppUrl: (p: string) => `https://app.test${p}` }))
jest.mock('@/lib/slack/notify-pending-action', () => ({ notifyPendingAction: jest.fn() }))
jest.mock('@/lib/slack/notify-auto-executed', () => ({
  notifyAutoExecuted: jest.fn(),
  resolveApprovalsTarget: jest.fn(),
}))
jest.mock('../execute', () => ({ approveAndExecute: jest.fn() }))
jest.mock('../registry', () => ({
  getActionDefinition: (t: string) => {
    const base = { deckKey: 'seller-hub', paramsSchema: z.object({}), scope: 'sellerhub:write' }
    if (t === 'ext.action') return { ...base, external: true }
    if (t === 'fn.action')
      return {
        ...base,
        paramsSchema: z.object({ learn: z.boolean().optional() }),
        external: (p: { learn?: boolean }) => p.learn !== false,
      }
    if (t === 'auto.action')
      return {
        ...base,
        resultUrl: (r: { planId: string }, c: { spaceId: string }) =>
          `https://app.test/plans/${r.planId}?spaceId=${c.spaceId}`,
      }
    return base
  },
}))

const p = prisma as unknown as {
  agentPendingAction: { findUnique: jest.Mock; create: jest.Mock }
  spaceAgent: { findFirst: jest.Mock }
}
const approve = approveAndExecute as jest.Mock
const notify = notifyPendingAction as jest.Mock
const notifyAuto = notifyAutoExecuted as jest.Mock
const target = resolveApprovalsTarget as jest.Mock
const expiresAt = new Date('2026-11-20T00:00:00Z')
const draft = {
  spaceId: 'sp1',
  actionType: 'auto.action',
  params: {},
  summary: 's',
  source: 'MCP' as const,
  actor: { type: 'agent' as const, id: 'ag1' },
  actorTokenId: 'tok1',
}

const agentRow = {
  scopes: ['sellerhub:write'],
  writeGrants: { 'sellerhub:write': { userId: 'admin1', at: '2026-11-20T00:00:00Z' } },
}

beforeEach(() => {
  jest.clearAllMocks()
  p.agentPendingAction.create.mockResolvedValue({ id: 'a1', spaceId: 'sp1', expiresAt })
  p.spaceAgent.findFirst.mockResolvedValue(agentRow)
  target.mockResolvedValue({ botToken: 't', botTokenIv: 'i', channelId: 'C1' })
})

test('agent: 쓰기 scope+부여자 → 부여자로 승인·실행, executed + resultUrl, 실행 알림만 보낸다', async () => {
  approve.mockResolvedValue({ ok: true, status: 'EXECUTED', result: { planId: 'pl1' } })
  const res = await createPendingAction(draft)
  expect(approve).toHaveBeenCalledWith('a1', 'admin1', {
    autoGate: { kind: 'agent', agentId: 'ag1', tokenId: 'tok1', requiredScope: 'sellerhub:write' },
  })
  expect(res).toMatchObject({
    status: 'executed',
    actionId: 'a1',
    resultUrl: 'https://app.test/plans/pl1?spaceId=sp1',
    result: { planId: 'pl1' },
  })
  expect(notifyAuto).toHaveBeenCalledWith('a1', {
    resultUrl: 'https://app.test/plans/pl1?spaceId=sp1',
  })
  expect(notify).not.toHaveBeenCalled()
})

test('integration: 인증된 구성원이 결정자 — Slack 요청자 해석값(requesterUserId)은 쓰지 않는다', async () => {
  p.spaceAgent.findFirst.mockResolvedValue({ scopes: ['sellerhub:write'], writeGrants: {} })
  approve.mockResolvedValue({ ok: true, status: 'EXECUTED', result: { planId: 'pl1' } })
  await createPendingAction({
    ...draft,
    actor: { type: 'integration', id: 'ag1' },
    actorTokenId: null,
    requesterUserId: 'slack-resolved-user',
    authenticatedUserId: 'member1',
  })
  expect(approve).toHaveBeenCalledWith('a1', 'member1', {
    autoGate: { kind: 'integration', agentId: 'ag1', requiredScope: 'sellerhub:write' },
  })
  expect(notifyAuto).toHaveBeenCalled()
})

test.each([
  ['쓰기 scope 없음(읽기만)', { scopes: ['sellerhub:read'], writeGrants: {} }],
  ['부여자 기록 없는 기존 쓰기', { scopes: ['sellerhub:write'], writeGrants: {} }],
  ['null writeGrants', { scopes: ['sellerhub:write'], writeGrants: null }],
])('agent %s → 승인 대기 + 승인 알림', async (_n, agentRow) => {
  p.spaceAgent.findFirst.mockResolvedValue(agentRow)
  const res = await createPendingAction(draft)
  expect(approve).not.toHaveBeenCalled()
  expect(res.status).toBe('pending_approval')
  expect(notify).toHaveBeenCalledWith('a1')
  expect(notifyAuto).not.toHaveBeenCalled()
})

test('user(구성원 본인 세션): 에이전트 행 조회 없이 그 구성원이 결정자로 바로 실행', async () => {
  approve.mockResolvedValue({ ok: true, status: 'EXECUTED', result: { planId: 'pl1' } })
  const res = await createPendingAction({
    ...draft,
    actor: { type: 'user', id: 'u1' },
    actorTokenId: null,
    authenticatedUserId: 'u1',
  })
  expect(p.spaceAgent.findFirst).not.toHaveBeenCalled()
  expect(approve).toHaveBeenCalledWith('a1', 'u1', {
    autoGate: { kind: 'user', requiredScope: 'sellerhub:write' },
  })
  expect(res.status).toBe('executed')
  expect(notifyAuto).toHaveBeenCalled()
})

test('user: 인증 구성원이 없거나 행위자와 다르면(웹 POST·Slack 해석값) 승인 대기', async () => {
  for (const authenticatedUserId of [undefined, 'other']) {
    const res = await createPendingAction({
      ...draft,
      actor: { type: 'user', id: 'u1' },
      actorTokenId: null,
      requesterUserId: 'u1',
      authenticatedUserId,
    })
    expect(res.status).toBe('pending_approval')
  }
  expect(approve).not.toHaveBeenCalled()
})

test('user 외부 액션 → 승인 대기', async () => {
  const res = await createPendingAction({
    ...draft,
    actionType: 'ext.action',
    actor: { type: 'user', id: 'u1' },
    actorTokenId: null,
    authenticatedUserId: 'u1',
  })
  expect(res.status).toBe('pending_approval')
  expect(approve).not.toHaveBeenCalled()
})

test.each([
  ['외부 액션', { actionType: 'ext.action' }],
  ['learn 기본(함수형 external=true)', { actionType: 'fn.action', params: {} }],
  ['agent 토큰 없음', { actorTokenId: null }],
  [
    'integration 인증 구성원 없음',
    { actor: { type: 'integration' as const, id: 'ag1' }, actorTokenId: null },
  ],
  ['system 행위자', { actor: { type: 'system' as const, id: 'workdeck-agent' } }],
  ['user 행위자', { actor: { type: 'user' as const, id: 'u1' } }],
])('%s → 바로 실행하지 않고 승인 대기', async (_n, patch) => {
  const res = await createPendingAction({ ...draft, ...patch })
  expect(approve).not.toHaveBeenCalled()
  expect(res.status).toBe('pending_approval')
  expect(notify).toHaveBeenCalled()
})

test('함수형 external — learn:false 면 바로 실행', async () => {
  approve.mockResolvedValue({ ok: true, status: 'EXECUTED', result: {} })
  const res = await createPendingAction({
    ...draft,
    actionType: 'fn.action',
    params: { learn: false },
  })
  expect(res.status).toBe('executed')
})

test('Slack 실행 알림 대상 없음 → 바로 실행하지 않고 승인 대기(기존 알림 경로)', async () => {
  target.mockResolvedValue(null)
  const res = await createPendingAction(draft)
  expect(approve).not.toHaveBeenCalled()
  expect(res.status).toBe('pending_approval')
  expect(notify).toHaveBeenCalledWith('a1')
})

test.each([
  ['관리자 강등(FORBIDDEN)', { ok: false, status: 'FORBIDDEN', message: '권한 부족' }, '권한 부족'],
  [
    '게이트 거부(scope 회수·토큰 폐기·결정자 강등)',
    { ok: false, status: 'BLOCKED', message: '바로 실행 조건이 맞지 않습니다' },
    '바로 실행 조건이 맞지 않습니다',
  ],
])('%s → PENDING 유지, 알림 + autoExecuteSkipped', async (_n, outcome, reason) => {
  approve.mockResolvedValue(outcome)
  const res = await createPendingAction(draft)
  expect(res).toMatchObject({ status: 'pending_approval', autoExecuteSkipped: reason })
  expect(notify).toHaveBeenCalledWith('a1')
})

test('실행 실패 → failed + error, 실행 알림(실패)만 보낸다', async () => {
  approve.mockResolvedValue({ ok: false, status: 'FAILED', error: '상품 없음' })
  const res = await createPendingAction(draft)
  expect(res).toMatchObject({ status: 'failed', error: '상품 없음' })
  expect(notifyAuto).toHaveBeenCalledWith('a1')
  expect(notify).not.toHaveBeenCalled()
})

test('EXPIRED → expired (DB 재조회 없음)', async () => {
  approve.mockResolvedValue({ ok: false, status: 'EXPIRED', message: 'm' })
  const res = await createPendingAction(draft)
  expect(res.status).toBe('expired')
  expect(p.agentPendingAction.findUnique).not.toHaveBeenCalled()
})

test.each([
  ['APPROVED', 'executing'],
  ['FAILED', 'failed'],
  ['REJECTED', 'rejected'],
  ['EXPIRED', 'expired'],
])('CONFLICT → DB 상태 %s 를 %s 로 응답, 알림 없음', async (dbStatus, expected) => {
  approve.mockResolvedValue({ ok: false, status: 'CONFLICT', message: 'c' })
  p.agentPendingAction.findUnique.mockResolvedValue({
    id: 'a1',
    spaceId: 'sp1',
    expiresAt,
    status: dbStatus,
    actionType: 'auto.action',
    result: null,
    error: 'e',
  })
  const res = await createPendingAction(draft)
  expect(res.status).toBe(expected)
  expect(notify).not.toHaveBeenCalled()
  expect(notifyAuto).not.toHaveBeenCalled()
})

test.each([
  ['EXECUTED', { planId: 'pl9' }, { resultUrl: 'https://app.test/plans/pl9?spaceId=sp1' }],
  ['FAILED', null, undefined],
])('CONFLICT 후 저장된 autoExecuted %s → 실행 알림 보낸다', async (status, result, opts) => {
  approve.mockResolvedValue({ ok: false, status: 'CONFLICT', message: 'c' })
  p.agentPendingAction.findUnique.mockResolvedValue({
    id: 'a1',
    spaceId: 'sp1',
    expiresAt,
    status,
    actionType: 'auto.action',
    result,
    error: 'e',
    autoExecuted: true,
  })
  await createPendingAction(draft)
  expect(notifyAuto.mock.calls[0]).toEqual(opts ? ['a1', opts] : ['a1', {}])
})

test('CONFLICT 후 EXECUTED → executed + 저장된 결과로 resultUrl', async () => {
  approve.mockResolvedValue({ ok: false, status: 'CONFLICT', message: 'c' })
  p.agentPendingAction.findUnique.mockResolvedValue({
    id: 'a1',
    spaceId: 'sp1',
    expiresAt,
    status: 'EXECUTED',
    actionType: 'auto.action',
    result: { planId: 'pl9' },
    error: null,
  })
  const res = await createPendingAction(draft)
  expect(res).toMatchObject({
    status: 'executed',
    resultUrl: 'https://app.test/plans/pl9?spaceId=sp1',
  })
  expect(notify).not.toHaveBeenCalled()
})

test('멱등 경로는 저장된 실제 상태를 반영한다(EXECUTED + resultUrl)', async () => {
  p.agentPendingAction.findUnique.mockResolvedValue({
    id: 'a1',
    spaceId: 'sp1',
    expiresAt,
    status: 'EXECUTED',
    actionType: 'auto.action',
    result: { planId: 'pl1' },
    error: null,
  })
  const res = await createPendingAction({ ...draft, idempotencyKey: 'k' })
  expect(res).toMatchObject({
    status: 'executed',
    resultUrl: 'https://app.test/plans/pl1?spaceId=sp1',
  })
  expect(p.agentPendingAction.create).not.toHaveBeenCalled()
})
