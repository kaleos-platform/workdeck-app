import { createHash } from 'node:crypto'
import { z } from 'zod'
import { resolveMcpDeckContext, resolveMcpWorkspace } from '@/lib/mcp/context'
// resolveMcpDeckContext: finance/seller-hub(Space 스코프) 게이트. resolveMcpWorkspace: coupang-ads.
import { createPendingAction } from '@/lib/agent/actions/create'
import type { ToolDefinition } from './types'

/**
 * MCP write tool — 상태 변경 요청. 절대 직접 mutate하지 않고 createPendingAction()만 호출한다.
 * 반환: { status:'pending_approval', actionId, approvalUrl, expiresAt } + 승인 안내 텍스트.
 * 실제 실행은 사용자가 웹 승인 큐(또는 Slack)에서 승인해야 일어난다.
 */

// 액션 파라미터로 안정적 멱등 키 생성 — 동일 요청 재시도가 중복 액션을 만들지 않도록.
function idempotencyKeyFor(actionType: string, spaceId: string, params: unknown): string {
  const h = createHash('sha256')
  h.update(actionType)
  h.update('\0')
  h.update(spaceId)
  h.update('\0')
  h.update(JSON.stringify(params ?? {}))
  return `${actionType}:${h.digest('hex').slice(0, 32)}`
}

// coupang-ads write tool의 space 게이트 — Workspace 스코프지만 승인 큐는 Space 스코프라
// 큐잉하려면 Space가 필요하다. 레거시(Space 없음)면 큐잉 불가로 throw.
function requireSpace(space: { id: string } | null): { id: string } {
  if (!space) {
    throw new Error('승인 큐를 사용하려면 Space가 필요합니다')
  }
  return space
}

// ─── finance ─────────────────────────────────────────────────────────────────

const financeClassifyTransactionsTool: ToolDefinition = {
  name: 'finance_classify_transactions',
  description:
    '거래의 계정과목을 변경(재분류)하도록 요청합니다. 즉시 실행되지 않고 승인 대기 큐에 등록되며, 관리자(ADMIN) 승인 후에 실제로 반영됩니다.',
  inputSchema: {
    transactionId: z.string(),
    categoryId: z.string(),
    learn: z.boolean().optional(),
  },
  mode: 'write',
  async execute(ctx, params) {
    const { space } = await resolveMcpDeckContext(ctx.userId, 'finance')
    const actionParams = {
      transactionId: params.transactionId as string,
      categoryId: params.categoryId as string,
      learn: params.learn as boolean | undefined,
    }
    const summary = `거래 ${actionParams.transactionId} 재분류 → 계정과목 ${actionParams.categoryId}`
    const r = await createPendingAction({
      spaceId: space.id,
      actionType: 'finance.transaction.reclassify',
      params: actionParams,
      summary,
      source: 'MCP',
      requestedBy: ctx.userId,
      idempotencyKey: idempotencyKeyFor('finance.transaction.reclassify', space.id, actionParams),
    })
    return r
  },
}

const financeCreateClassRuleTool: ToolDefinition = {
  name: 'finance_create_class_rule',
  description:
    '거래 자동 분류 규칙을 생성하도록 요청합니다. memo(선택)를 함께 저장하면 이 규칙으로 자동분류된 거래에 메모가 복사됩니다. 즉시 생성되지 않고 승인 대기 큐에 등록되며, 관리자(ADMIN) 승인 후에 실제로 반영됩니다.',
  inputSchema: {
    matchKey: z.string().min(1),
    categoryId: z.string(),
    matchType: z.enum(['EXACT', 'KEYWORD']),
    memo: z.string().optional(),
  },
  mode: 'write',
  async execute(ctx, params) {
    const { space } = await resolveMcpDeckContext(ctx.userId, 'finance')
    const actionParams = {
      matchKey: params.matchKey as string,
      categoryId: params.categoryId as string,
      matchType: params.matchType as 'EXACT' | 'KEYWORD',
      memo: params.memo as string | undefined,
    }
    const summary = `분류 규칙 생성: "${actionParams.matchKey}" (${actionParams.matchType}) → 계정과목 ${actionParams.categoryId}`
    const r = await createPendingAction({
      spaceId: space.id,
      actionType: 'finance.classrule.create',
      params: actionParams,
      summary,
      source: 'MCP',
      requestedBy: ctx.userId,
      idempotencyKey: idempotencyKeyFor('finance.classrule.create', space.id, actionParams),
    })
    return r
  },
}

// ─── seller-hub ────────────────────────────────────────────────────────────────

const sellerhubCreateReorderPlanTool: ToolDefinition = {
  name: 'sellerhub_create_reorder_plan',
  description:
    '상품의 발주 계획(초안)을 생성하도록 요청합니다. 즉시 생성되지 않고 승인 대기 큐에 등록되며, 관리자(ADMIN) 승인 후에 실제로 생성됩니다.',
  inputSchema: {
    productId: z.string(),
    optionIds: z.array(z.string()).optional(),
    memo: z.string().optional(),
  },
  mode: 'write',
  async execute(ctx, params) {
    const { space } = await resolveMcpDeckContext(ctx.userId, 'seller-hub')
    const actionParams = {
      productId: params.productId as string,
      optionIds: params.optionIds as string[] | undefined,
      memo: params.memo as string | undefined,
    }
    const summary = `발주 계획 생성: 상품 ${actionParams.productId}`
    const r = await createPendingAction({
      spaceId: space.id,
      actionType: 'seller-hub.reorder.plan.create',
      params: actionParams,
      summary,
      source: 'MCP',
      requestedBy: ctx.userId,
      idempotencyKey: idempotencyKeyFor('seller-hub.reorder.plan.create', space.id, actionParams),
    })
    return r
  },
}

// ─── coupang-ads (Workspace 스코프) ──────────────────────────────────────────────

const adsTriggerAnalysisTool: ToolDefinition = {
  name: 'ads_trigger_analysis',
  description:
    'AI 광고 분석을 실행하도록 요청합니다. 즉시 실행되지 않고 승인 대기 큐에 등록되며, 관리자(ADMIN) 승인 후에 분석이 트리거됩니다.',
  inputSchema: {
    from: z.string(),
    to: z.string(),
    reportType: z
      .enum(['DAILY_REVIEW', 'KEYWORD_AUDIT', 'BUDGET_OPTIMIZATION', 'CAMPAIGN_SCORING'])
      .optional(),
  },
  mode: 'write',
  async execute(ctx, params) {
    // Workspace 스코프 게이트(coupang-ads 활성 검사 포함) + 큐잉용 Space를 한 번에 조회.
    const { workspace, space: maybeSpace } = await resolveMcpWorkspace(ctx.userId)
    const space = requireSpace(maybeSpace)
    const actionParams = {
      workspaceId: workspace.id,
      from: params.from as string,
      to: params.to as string,
      reportType: params.reportType as string | undefined,
    }
    const summary = `AI 광고 분석 실행: ${actionParams.from}~${actionParams.to} (${actionParams.reportType ?? 'DAILY_REVIEW'})`
    const r = await createPendingAction({
      spaceId: space.id,
      actionType: 'coupang-ads.analysis.trigger',
      params: actionParams,
      summary,
      source: 'MCP',
      requestedBy: ctx.userId,
      idempotencyKey: idempotencyKeyFor('coupang-ads.analysis.trigger', space.id, actionParams),
    })
    return r
  },
}

const adsApproveExecutionTaskTool: ToolDefinition = {
  name: 'ads_approve_execution_task',
  description:
    '광고 실행 태스크(입찰/예산 변경 등)를 승인하도록 요청합니다. 즉시 승인되지 않고 승인 대기 큐에 등록되며, 관리자(ADMIN) 승인 후에 태스크가 실행 대기 상태가 됩니다.',
  inputSchema: {
    taskId: z.string(),
  },
  mode: 'write',
  async execute(ctx, params) {
    const { workspace, space: maybeSpace } = await resolveMcpWorkspace(ctx.userId)
    const space = requireSpace(maybeSpace)
    const actionParams = {
      taskId: params.taskId as string,
      workspaceId: workspace.id,
    }
    const summary = `광고 실행 태스크 승인: ${actionParams.taskId}`
    const r = await createPendingAction({
      spaceId: space.id,
      actionType: 'coupang-ads.execution.approve',
      params: actionParams,
      summary,
      source: 'MCP',
      requestedBy: ctx.userId,
      idempotencyKey: idempotencyKeyFor('coupang-ads.execution.approve', space.id, actionParams),
    })
    return r
  },
}

export const writeTools: ToolDefinition[] = [
  financeClassifyTransactionsTool,
  financeCreateClassRuleTool,
  sellerhubCreateReorderPlanTool,
  adsTriggerAnalysisTool,
  adsApproveExecutionTaskTool,
]
