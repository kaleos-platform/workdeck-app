/** @jest-environment node */
// 쓰기 도구가 모두 행위자·요청자·workId를 승인 큐 제안에 그대로 싣는지.
// 구성원이 아닌 Slack 발신자(요청자 null)도 member 취급 없이 pending_approval로만 남는다.
jest.mock('@/lib/mcp/context', () => ({
  requireDeck: jest.fn(async () => undefined),
  resolveMcpWorkspace: jest.fn(async () => ({ id: 'ws1' })),
}))
jest.mock('@/lib/agent/actions/create', () => ({
  createPendingAction: jest.fn(async () => ({ status: 'pending_approval', actionId: 'a1' })),
}))
jest.mock('@/lib/sh/keyword-apply', () => ({
  readTargetKeywords: jest.fn(async () => ({ name: '상품', keywords: [] })),
}))
import { createPendingAction } from '@/lib/agent/actions/create'
import { writeTools } from '../write-tools'
import type { McpToolContext } from '../types'
import { ALL_SCOPES } from '@/lib/agent/identity/principal'

const ctx: McpToolContext = {
  spaceId: 'sp1',
  actor: { type: 'system', id: 'workdeck-agent' },
  scopes: ALL_SCOPES,
  workId: 'wk_fixed',
  requesterUserId: null,
  requesterSlackUserId: 'UEXT9',
  decryptedCredentialIds: [],
}
const ARGS: Record<string, Record<string, unknown>> = {
  finance_classify_transactions: { transactionId: 't1', categoryId: 'c1' },
  finance_create_class_rule: { matchKey: 'k', categoryId: 'c1', matchType: 'EXACT' },
  sellerhub_create_reorder_plan: { productId: 'p1' },
  sellerhub_propose_keyword_update: { target: { listingId: 'l1' }, add: ['a'], remove: [] },
  ads_trigger_analysis: { from: '2026-10-01', to: '2026-10-02' },
  ads_approve_execution_task: { taskId: 'task1' },
}

it.each(writeTools.map((t) => [t.name, t] as const))(
  '%s → 미확인 요청자도 행위자·요청자·workId를 그대로 싣고 pending_approval',
  async (name, tool) => {
    ;(createPendingAction as jest.Mock).mockClear()
    await expect(tool.execute(ctx, ARGS[name])).resolves.toMatchObject({
      status: 'pending_approval',
    })
    expect(createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'system', id: 'workdeck-agent' },
        requesterUserId: null,
        requesterSlackUserId: 'UEXT9',
        workId: 'wk_fixed',
      })
    )
  }
)

it('발주 계획 멱등 키는 KST 날짜 단위 — 같은 날 같은 요청=같은 키, 다음 날=새 키, 토큰 id 전달', async () => {
  const tool = writeTools.find((t) => t.name === 'sellerhub_create_reorder_plan')!
  const c = createPendingAction as jest.Mock
  c.mockClear()
  jest.useFakeTimers({ now: new Date('2026-11-18T03:00:00Z') })
  try {
    const tctx = { ...ctx, actorTokenId: 'tok1' }
    await tool.execute(tctx, { productId: 'p1' })
    jest.setSystemTime(new Date('2026-11-18T14:00:00Z')) // KST 23시 — 같은 날
    await tool.execute(tctx, { productId: 'p1' })
    jest.setSystemTime(new Date('2026-11-25T03:00:00Z'))
    await tool.execute(tctx, { productId: 'p1' })
    const keys = c.mock.calls.map((x) => x[0].idempotencyKey)
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[0])
    expect(c.mock.calls[0][0].actorTokenId).toBe('tok1')
  } finally {
    jest.useRealTimers()
  }
})

// 바로 실행(내부) 도구는 토큰 id·인증된 구성원을 제안에 싣는다 — 게이트가 에이전트 토큰·연동 계정 결정자를 확인하는 근거.
it.each([
  'finance_classify_transactions',
  'sellerhub_create_reorder_plan',
  'sellerhub_propose_keyword_update',
  'ads_trigger_analysis',
])('%s → actorTokenId·authenticatedUserId 를 그대로 싣는다', async (name) => {
  ;(createPendingAction as jest.Mock).mockClear()
  const tool = writeTools.find((t) => t.name === name)!
  await tool.execute(
    {
      ...ctx,
      actor: { type: 'integration', id: 'ig1' },
      actorTokenId: 'tok1',
      authenticatedUserId: 'member1',
    },
    ARGS[name]
  )
  expect(createPendingAction).toHaveBeenCalledWith(
    expect.objectContaining({ actorTokenId: 'tok1', authenticatedUserId: 'member1' })
  )
})
