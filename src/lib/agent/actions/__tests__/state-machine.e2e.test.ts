/**
 * Phase 4 승인 큐 상태머신 e2e — 실 dev DB.
 * 실행 전제: .env.local(dev DB). 없으면 describe.skip.
 *
 * 검증: 조건부 update 경합 게이트(execute 정확히 1회), 상태 전이(EXECUTED/FAILED/REJECTED),
 *       idempotencyKey 멱등, lazy expire, paramsSchema 검증 실패.
 */
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '../create'
import { approveAndExecute, rejectAction, expirePendingActions } from '../execute'
import { __registerActionForTest } from '../registry'
import type { ActionDefinition } from '../types'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000a1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000a2'

// 실행 횟수를 세는 제어 가능한 테스트 액션. execute가 정확히 몇 번 불렸는지 검증한다.
let execCount = 0
const TEST_TYPE = 'test.statemachine.noop'
const paramsSchema = z.object({ value: z.number() })

const testAction: ActionDefinition = {
  actionType: TEST_TYPE,
  deckKey: 'finance',
  title: '테스트 액션',
  paramsSchema,
  requiredRole: 'ADMIN',
  async execute(_ctx, params) {
    execCount += 1
    return { doubled: (params as { value: number }).value * 2 }
  },
}

// execute가 항상 throw하는 액션 — FAILED 전이 검증용.
const FAIL_TYPE = 'test.statemachine.fail'
const failAction: ActionDefinition = {
  actionType: FAIL_TYPE,
  deckKey: 'finance',
  title: '실패 테스트 액션',
  paramsSchema: z.object({}),
  requiredRole: 'ADMIN',
  async execute() {
    throw new Error('의도된 실패')
  },
}

let unregister: Array<() => void> = []

d('AgentPendingAction 상태머신', () => {
  beforeAll(async () => {
    unregister.push(__registerActionForTest(testAction))
    unregister.push(__registerActionForTest(failAction))
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-agent@throwaway.test', name: 'E2E Agent' },
    })
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E Agent Throwaway', type: 'PERSONAL' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_ID, userId: USER_ID } },
      update: {},
      create: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' },
    })
  })

  afterEach(async () => {
    execCount = 0
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: SPACE_ID } })
  })

  afterAll(async () => {
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.spaceMember.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: SPACE_ID } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
    unregister.forEach((u) => u())
    unregister = []
    await prisma.$disconnect()
  })

  async function makeAction(idempotencyKey?: string) {
    return createPendingAction({
      spaceId: SPACE_ID,
      actionType: TEST_TYPE,
      params: { value: 21 },
      summary: '테스트',
      source: 'MCP',
      requestedBy: USER_ID,
      idempotencyKey,
    })
  }

  test('생성 → PENDING + expiresAt ~72h + approvalUrl', async () => {
    const r = await makeAction()
    expect(r.status).toBe('pending_approval')
    const row = await prisma.agentPendingAction.findUnique({ where: { id: r.actionId } })
    expect(row?.status).toBe('PENDING')
    expect(r.approvalUrl).toContain(r.actionId)
    // expiresAt ≈ now + 72h (여유 5분)
    const diffH = (new Date(r.expiresAt).getTime() - Date.now()) / 3_600_000
    expect(diffH).toBeGreaterThan(71.9)
    expect(diffH).toBeLessThan(72.1)
  })

  test('승인 → EXECUTED + result 저장 + execute 1회', async () => {
    const { actionId } = await makeAction()
    const out = await approveAndExecute(actionId, USER_ID)
    expect(out).toMatchObject({ ok: true, status: 'EXECUTED' })
    expect(execCount).toBe(1)
    const row = await prisma.agentPendingAction.findUnique({ where: { id: actionId } })
    expect(row?.status).toBe('EXECUTED')
    expect(row?.result).toEqual({ doubled: 42 })
    expect(row?.decidedBy).toBe(USER_ID)
    expect(row?.executedAt).not.toBeNull()
  })

  test('거부 → REJECTED, execute 미실행', async () => {
    const { actionId } = await makeAction()
    const out = await rejectAction(actionId, USER_ID)
    expect(out).toMatchObject({ ok: false, status: 'REJECTED' })
    expect(execCount).toBe(0)
    const row = await prisma.agentPendingAction.findUnique({ where: { id: actionId } })
    expect(row?.status).toBe('REJECTED')
  })

  test('동시 승인 경합 → 정확히 1회 execute, 패자 CONFLICT', async () => {
    const { actionId } = await makeAction()
    // 두 승인을 동시에 발사 — 조건부 update가 하나만 통과시켜야 한다.
    const [a, b] = await Promise.all([
      approveAndExecute(actionId, USER_ID),
      approveAndExecute(actionId, USER_ID),
    ])
    const outcomes = [a, b]
    const executed = outcomes.filter((o) => o.status === 'EXECUTED')
    const conflicts = outcomes.filter((o) => o.status === 'CONFLICT')
    expect(executed).toHaveLength(1)
    expect(conflicts).toHaveLength(1)
    // 게이트가 execute를 정확히 1회로 제한했는지 — 핵심 불변식.
    expect(execCount).toBe(1)
    const row = await prisma.agentPendingAction.findUnique({ where: { id: actionId } })
    expect(row?.status).toBe('EXECUTED')
  })

  test('승인 후 재승인 → CONFLICT (재실행 없음)', async () => {
    const { actionId } = await makeAction()
    await approveAndExecute(actionId, USER_ID)
    expect(execCount).toBe(1)
    const again = await approveAndExecute(actionId, USER_ID)
    expect(again.status).toBe('CONFLICT')
    expect(execCount).toBe(1) // 재실행 안 됨
  })

  test('execute throw → FAILED(+error), APPROVED에 머물지 않음', async () => {
    const created = await createPendingAction({
      spaceId: SPACE_ID,
      actionType: FAIL_TYPE,
      params: {},
      summary: '실패',
      source: 'MCP',
      requestedBy: USER_ID,
    })
    const out = await approveAndExecute(created.actionId, USER_ID)
    expect(out).toMatchObject({ ok: false, status: 'FAILED' })
    const row = await prisma.agentPendingAction.findUnique({ where: { id: created.actionId } })
    expect(row?.status).toBe('FAILED')
    expect(row?.error).toContain('의도된 실패')
  })

  test('idempotencyKey 재요청 → 동일 액션 반환(중복 생성 없음)', async () => {
    const key = `idem-${Date.now()}`
    const first = await makeAction(key)
    const second = await makeAction(key)
    expect(second.actionId).toBe(first.actionId)
    const count = await prisma.agentPendingAction.count({
      where: { spaceId: SPACE_ID, idempotencyKey: key },
    })
    expect(count).toBe(1)
  })

  test('paramsSchema 검증 실패 → throw, 생성 안 됨', async () => {
    await expect(
      createPendingAction({
        spaceId: SPACE_ID,
        actionType: TEST_TYPE,
        params: { value: 'not-a-number' },
        summary: '잘못된 파라미터',
        source: 'MCP',
        requestedBy: USER_ID,
      })
    ).rejects.toThrow(/파라미터/)
    const count = await prisma.agentPendingAction.count({ where: { spaceId: SPACE_ID } })
    expect(count).toBe(0)
  })

  test('lazy expire → 만료 PENDING만 EXPIRED', async () => {
    const { actionId } = await makeAction()
    // expiresAt을 과거로 강제.
    await prisma.agentPendingAction.update({
      where: { id: actionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const expired = await expirePendingActions()
    expect(expired).toBeGreaterThanOrEqual(1)
    const row = await prisma.agentPendingAction.findUnique({ where: { id: actionId } })
    expect(row?.status).toBe('EXPIRED')
    // 만료된 액션 승인 시도 → CONFLICT
    const out = await approveAndExecute(actionId, USER_ID)
    expect(out.status).toBe('CONFLICT')
    expect(execCount).toBe(0)
  })
})
