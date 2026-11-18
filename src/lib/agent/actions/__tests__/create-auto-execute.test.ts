/** @jest-environment node */
// createPendingAction — 「초안 자동 실행」: 대상 액션·토큰 있는 에이전트·스위치 켜짐일 때만 승인 없이 실행한다.
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { notifyPendingAction } from '@/lib/slack/notify-pending-action'
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
jest.mock('../execute', () => ({ approveAndExecute: jest.fn() }))
jest.mock('../registry', () => ({
  getActionDefinition: (t: string) => {
    const base = { deckKey: 'seller-hub', paramsSchema: z.object({}) }
    if (t === 'auto.action')
      return {
        ...base,
        autoExecutable: true,
        resultUrl: (r: { planId: string }, c: { spaceId: string }) =>
          `https://app.test/plans/${r.planId}?spaceId=${c.spaceId}`,
      }
    return base // 비대상(update_draft 등)
  },
}))

const p = prisma as unknown as {
  agentPendingAction: { findUnique: jest.Mock; create: jest.Mock }
  spaceAgent: { findFirst: jest.Mock }
}
const approve = approveAndExecute as jest.Mock
const notify = notifyPendingAction as jest.Mock
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

beforeEach(() => {
  jest.clearAllMocks()
  p.agentPendingAction.create.mockResolvedValue({ id: 'a1', spaceId: 'sp1', expiresAt })
  p.spaceAgent.findFirst.mockResolvedValue({
    autoExecuteDrafts: true,
    autoExecuteEnabledById: 'admin1',
  })
})

test('켜짐 → 켠 관리자로 승인·실행, executed + resultUrl, 승인 알림 없음', async () => {
  approve.mockResolvedValue({ ok: true, status: 'EXECUTED', result: { planId: 'pl1' } })
  const res = await createPendingAction(draft)
  expect(approve).toHaveBeenCalledWith('a1', 'admin1', {
    autoGate: { agentId: 'ag1', tokenId: 'tok1' },
  })
  expect(p.spaceAgent.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'ag1', spaceId: 'sp1' } })
  )
  expect(res).toMatchObject({
    status: 'executed',
    actionId: 'a1',
    resultUrl: 'https://app.test/plans/pl1?spaceId=sp1',
    result: { planId: 'pl1' },
  })
  expect(notify).not.toHaveBeenCalled()
})

test('꺼짐 → 승인 대기 + 알림', async () => {
  p.spaceAgent.findFirst.mockResolvedValue({
    autoExecuteDrafts: false,
    autoExecuteEnabledById: null,
  })
  const res = await createPendingAction(draft)
  expect(approve).not.toHaveBeenCalled()
  expect(res.status).toBe('pending_approval')
  expect(notify).toHaveBeenCalledWith('a1')
})

test.each([
  ['비대상 액션(update_draft 등)', { actionType: 'other.action' }],
  ['토큰 없음', { actorTokenId: null }],
  ['integration 행위자', { actor: { type: 'integration' as const, id: 'ag1' } }],
])('%s → 자동 실행하지 않고 승인 대기', async (_n, patch) => {
  const res = await createPendingAction({ ...draft, ...patch })
  expect(approve).not.toHaveBeenCalled()
  expect(res.status).toBe('pending_approval')
  expect(notify).toHaveBeenCalled()
})

test.each([
  ['관리자 강등(FORBIDDEN)', { ok: false, status: 'FORBIDDEN', message: '권한 부족' }, '권한 부족'],
  [
    '게이트 거부(스위치 꺼짐·토큰 폐기)',
    { ok: false, status: 'BLOCKED', message: '초안 자동 실행 조건이 맞지 않습니다' },
    '초안 자동 실행 조건이 맞지 않습니다',
  ],
])('%s → PENDING 유지, 알림 + autoExecuteSkipped', async (_n, outcome, reason) => {
  approve.mockResolvedValue(outcome)
  const res = await createPendingAction(draft)
  expect(res).toMatchObject({ status: 'pending_approval', autoExecuteSkipped: reason })
  expect(notify).toHaveBeenCalledWith('a1')
})

test('실행 실패 → failed + error, 알림 없음', async () => {
  approve.mockResolvedValue({ ok: false, status: 'FAILED', error: '상품 없음' })
  const res = await createPendingAction(draft)
  expect(res).toMatchObject({ status: 'failed', error: '상품 없음' })
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
