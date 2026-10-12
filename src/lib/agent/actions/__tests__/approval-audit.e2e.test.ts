/**
 * 승인 실행 감사 — 실 DB. 원래 행위자·요청자·workId와 승인자가 같은 행에 남고, 성공·실패 모두 기록된다.
 */
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '../create'
import { approveAndExecute } from '../execute'
import { __registerActionForTest } from '../registry'
import type { ActionDefinition, ActionExecContext } from '../types'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip
const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000f1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000f2'
let seen: ActionExecContext | null = null

const okAction: ActionDefinition = {
  actionType: 'test.audit.ok',
  deckKey: 'finance',
  title: 't',
  paramsSchema: z.object({}),
  requiredRole: 'ADMIN',
  async execute(ctx) {
    seen = ctx
    ctx.decryptedCredentialIds.push('cred-e2e')
    return { done: true }
  },
}
const failAction: ActionDefinition = {
  actionType: 'test.audit.fail',
  deckKey: 'finance',
  title: 't',
  paramsSchema: z.object({}),
  requiredRole: 'ADMIN',
  async execute() {
    throw new Error('의도된 실패')
  },
}
const unregister: Array<() => void> = []

d('승인 실행 감사', () => {
  beforeAll(async () => {
    unregister.push(__registerActionForTest(okAction), __registerActionForTest(failAction))
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-audit@throwaway.test', name: 'E2E Audit' },
    })
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E Audit', type: 'PERSONAL' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_ID, userId: USER_ID } },
      update: {},
      create: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' },
    })
  })
  afterAll(async () => {
    unregister.forEach((u) => u())
    await prisma.toolAuditLog.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.delete({ where: { id: SPACE_ID } }).catch(() => undefined)
    await prisma.user.delete({ where: { id: USER_ID } }).catch(() => undefined)
    await prisma.$disconnect()
  })

  const propose = (actionType: string, workId: string) =>
    createPendingAction({
      spaceId: SPACE_ID,
      actionType,
      params: {},
      summary: 'e2e',
      source: 'MCP',
      actor: { type: 'agent', id: 'ag-e2e' },
      requesterUserId: USER_ID,
      requesterSlackUserId: 'U123',
      workId,
    })

  it('성공: 실행 컨텍스트와 감사 행에 원래 행위자·요청자·workId, 별도 승인자', async () => {
    const r = await propose('test.audit.ok', 'wk_e2e_audit_ok')
    await expect(approveAndExecute(r.actionId, USER_ID)).resolves.toMatchObject({
      status: 'EXECUTED',
    })
    expect(seen).toMatchObject({
      actor: { type: 'agent', id: 'ag-e2e' },
      requesterUserId: USER_ID,
      workId: 'wk_e2e_audit_ok',
      deciderId: USER_ID,
    })
    const rows = await prisma.toolAuditLog.findMany({ where: { workId: 'wk_e2e_audit_ok' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      tool: 'action:test.audit.ok',
      outcome: 'ok',
      actorType: 'agent',
      actorId: 'ag-e2e',
      requesterUserId: USER_ID,
      deciderUserId: USER_ID,
      actionId: r.actionId,
      decryptedCredentialIds: ['cred-e2e'],
    })
  })

  it('실패도 같은 workId로 기록된다', async () => {
    const r = await propose('test.audit.fail', 'wk_e2e_audit_fail')
    await expect(approveAndExecute(r.actionId, USER_ID)).resolves.toMatchObject({
      status: 'FAILED',
    })
    const rows = await prisma.toolAuditLog.findMany({ where: { workId: 'wk_e2e_audit_fail' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      outcome: 'error',
      error: '의도된 실패',
      deciderUserId: USER_ID,
      actorId: 'ag-e2e',
    })
  })

  it('workId 없는 레거시 액션은 act_<actionId>로 묶인다', async () => {
    const r = await createPendingAction({
      spaceId: SPACE_ID,
      actionType: 'test.audit.ok',
      params: {},
      summary: 'e2e legacy',
      source: 'SYSTEM',
      actor: { type: 'system', id: 'worker' },
    })
    await approveAndExecute(r.actionId, USER_ID)
    const rows = await prisma.toolAuditLog.findMany({ where: { actionId: r.actionId } })
    expect(rows).toHaveLength(1)
    expect(rows[0].workId).toBe(`act_${r.actionId}`)
  })
})
