/** @jest-environment node */
// 실제 배선 검사 — 라우트 → resolveSlackMember → approveAndExecute → deciderDenial 를 그대로 쓰고
// DB(prisma)와 Slack 네트워크만 메모리 대역으로 바꾼다. 역할 검사가 실제로 상태 전이를 막는지 본다.
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { postResponseUrl } from '@/lib/slack/client'
import { __registerActionForTest } from '@/lib/agent/actions/registry'
import { POST } from '../route'

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    agentPendingAction: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    slackInstallation: { findUnique: jest.fn() },
    spaceMember: { findUnique: jest.fn() },
    space: { findUnique: jest.fn() },
    billingDeckProduct: { findUnique: jest.fn() },
  },
}))
jest.mock('@/lib/slack/verify', () => ({ verifySlackSignature: () => true }))
jest.mock('@/lib/slack/client', () => ({
  postResponseUrl: jest.fn().mockResolvedValue(undefined),
  slackGet: jest.fn(),
}))
jest.mock('@/lib/slack/sync-decision', () => ({ syncSlackDecision: jest.fn() }))
jest.mock('@/lib/slack/token-crypto', () => ({ decryptBotToken: () => 'xoxb-test' }))

type Db = {
  agentPendingAction: { findUnique: jest.Mock; updateMany: jest.Mock; update: jest.Mock }
  slackInstallation: { findUnique: jest.Mock }
  spaceMember: { findUnique: jest.Mock }
  space: { findUnique: jest.Mock }
  billingDeckProduct: { findUnique: jest.Mock }
}
const db = prisma as unknown as Db
const ephemeral = postResponseUrl as jest.Mock

const PLAIN = 'test.authz.plain'
const SPEND = 'test.authz.spend'
const executed: string[] = []
const unregister = [
  __registerActionForTest({
    actionType: PLAIN,
    deckKey: 'test-deck',
    title: '일반',
    paramsSchema: z.object({}),
    requiredRole: 'ADMIN',
    execute: async () => void executed.push(PLAIN),
  }),
  __registerActionForTest({
    actionType: SPEND,
    deckKey: 'test-deck',
    title: '지출',
    paramsSchema: z.object({ amountKrw: z.number().nullable() }),
    requiredRole: 'ADMIN',
    spendKrw: (p: { amountKrw: number | null }) => p.amountKrw,
    execute: async () => void executed.push(SPEND),
  } as never),
]
afterAll(() => unregister.forEach((u) => u()))

// Slack 사용자 → 구성원(이미 연결됨)
const MEMBERS: Record<string, { userId: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' }> = {
  U_OWNER: { userId: 'u-owner', role: 'OWNER' },
  U_ADMIN: { userId: 'u-admin', role: 'ADMIN' },
  U_MEMBER: { userId: 'u-member', role: 'MEMBER' },
}

let row: Record<string, unknown>

function seed(actionType: string, payload: unknown) {
  row = {
    id: 'act-1',
    status: 'PENDING',
    spaceId: 'space-1',
    deckKey: 'test-deck',
    slackChannelId: 'C1',
    actionType,
    payload,
    requestedBy: 'agent',
    expiresAt: new Date(Date.now() + 3600_000),
    decidedBy: null,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  executed.length = 0
  db.agentPendingAction.findUnique.mockImplementation(async () => ({ ...row }))
  // 조건부 전이 — PENDING 일 때만 1건 갱신(실제 DB 의 WHERE status='PENDING').
  db.agentPendingAction.updateMany.mockImplementation(async ({ where, data }) => {
    if (row.status !== where.status) return { count: 0 }
    Object.assign(row, data)
    return { count: 1 }
  })
  db.agentPendingAction.update.mockImplementation(async ({ data }) => Object.assign(row, data))
  db.slackInstallation.findUnique.mockResolvedValue({
    spaceId: 'space-1',
    botToken: 'enc',
    botTokenIv: 'v1',
  })
  db.spaceMember.findUnique.mockImplementation(async ({ where }) => {
    if (where.spaceId_slackUserId) return MEMBERS[where.spaceId_slackUserId.slackUserId] ?? null
    const m = Object.values(MEMBERS).find((x) => x.userId === where.spaceId_userId.userId)
    return m ? { role: m.role } : null
  })
  db.space.findUnique.mockResolvedValue({ approvalLimitKrw: 100_000 })
  db.billingDeckProduct.findUnique.mockResolvedValue(null) // 과금 카탈로그 밖 deck — entitlement 통과
})

function click(slackUserId: string) {
  const payload = {
    type: 'block_actions',
    user: { id: slackUserId },
    team: { id: 'T1' },
    channel: { id: 'C1' },
    response_url: 'https://hooks.slack.test/r',
    actions: [{ action_id: 'agent_action_approve', value: 'act-1' }],
  }
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString()
  return POST({ text: async () => body, headers: new Headers() } as unknown as NextRequest)
}

test('MEMBER 승인 → 상태 전이·실행 없음, ADMIN 안내', async () => {
  seed(PLAIN, {})
  await click('U_MEMBER')
  expect(row.status).toBe('PENDING')
  expect(db.agentPendingAction.updateMany).not.toHaveBeenCalled()
  expect(executed).toEqual([])
  expect(ephemeral.mock.calls[0][1].text).toContain('ADMIN')
})

test('ADMIN 이 일반 액션 승인 → 실행, decidedBy = User.id', async () => {
  seed(PLAIN, {})
  await click('U_ADMIN')
  expect(row.status).toBe('EXECUTED')
  expect(row.decidedBy).toBe('u-admin')
  expect(executed).toEqual([PLAIN])
})

test('ADMIN 이 한도 초과 지출 제안 승인 → 상태 전이·실행 없음, 지출 제안 안내', async () => {
  seed(SPEND, { amountKrw: 100_001 })
  await click('U_ADMIN')
  expect(row.status).toBe('PENDING')
  expect(db.agentPendingAction.updateMany).not.toHaveBeenCalled()
  expect(executed).toEqual([])
  expect(ephemeral.mock.calls[0][1].text).toContain('지출 제안')
})

test('OWNER 가 한도 초과 지출 제안 승인 → 실행', async () => {
  seed(SPEND, { amountKrw: 100_001 })
  await click('U_OWNER')
  expect(row.status).toBe('EXECUTED')
  expect(row.decidedBy).toBe('u-owner')
  expect(executed).toEqual([SPEND])
})

test('지출 액션 payload 해석 불가 → OWNER 필요(ADMIN 차단)', async () => {
  seed(SPEND, { amountKrw: 'x' })
  await click('U_ADMIN')
  expect(row.status).toBe('PENDING')
  expect(executed).toEqual([])
  expect(ephemeral.mock.calls[0][1].text).toContain('지출 제안')
})

test('spendKrw 가 null(이번 요청은 지출 아님) → 기본 역할(ADMIN)로 실행', async () => {
  seed(SPEND, { amountKrw: null })
  await click('U_ADMIN')
  expect(row.status).toBe('EXECUTED')
  expect(executed).toEqual([SPEND])
})

test('연결 안 된 Slack 사용자 → 결정 없음', async () => {
  seed(PLAIN, {})
  const { slackGet } = jest.requireMock('@/lib/slack/client') as { slackGet: jest.Mock }
  slackGet.mockResolvedValue({ ok: false, error: 'missing_scope' })
  await click('U_STRANGER')
  expect(row.status).toBe('PENDING')
  expect(executed).toEqual([])
  expect(ephemeral.mock.calls[0][1].text).toContain('Slack 연결')
})
