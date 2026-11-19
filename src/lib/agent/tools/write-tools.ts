import { createHash } from 'node:crypto'
import { z } from 'zod'
import { requireDeck, resolveMcpWorkspace } from '@/lib/mcp/context'
// requireDeck: finance/seller-hub(Space 스코프) 게이트. resolveMcpWorkspace: coupang-ads(Space에 연결된 Workspace).
import { readTargetKeywords } from '@/lib/sh/keyword-apply'
import { createPendingAction } from '@/lib/agent/actions/create'
import { getTodayStrKst } from '@/lib/date-range'
import type { ToolDefinition } from './types'

/**
 * MCP write tool — 상태 변경 요청. 절대 직접 mutate하지 않고 createPendingAction()만 호출한다.
 * 반환: { status:'pending_approval', actionId, approvalUrl, expiresAt } + 승인 안내 텍스트.
 * 실제 실행은 사용자가 웹 승인 큐(또는 Slack)에서 승인해야 일어난다.
 */

// 액션 파라미터로 안정적 멱등 키 생성 — 동일 요청 재시도가 중복 액션을 만들지 않도록.
export function idempotencyKeyFor(actionType: string, spaceId: string, params: unknown): string {
  const h = createHash('sha256')
  h.update(actionType)
  h.update('\0')
  h.update(spaceId)
  h.update('\0')
  h.update(JSON.stringify(params ?? {}))
  return `${actionType}:${h.digest('hex').slice(0, 32)}`
}

// ─── finance ─────────────────────────────────────────────────────────────────

const financeClassifyTransactionsTool: ToolDefinition = {
  name: 'finance_classify_transactions',
  description:
    '거래의 계정과목을 변경(재분류)합니다. learn 을 false 로 주면 이 거래 1건만 바꾸므로 쓰기 권한이 있으면 바로 실행되고 결과 링크를 돌려줍니다. 실행 전에 사용자에게 대상·내용을 확인받으세요. learn 을 생략하거나 true 로 주면 분류 규칙을 학습해 이후 자동 분류에 영향을 주므로 즉시 실행되지 않고 승인 대기 큐에 등록되며, 관리자(ADMIN) 승인 후에 반영됩니다.',
  inputSchema: {
    transactionId: z.string(),
    categoryId: z.string(),
    learn: z.boolean().optional(),
  },
  mode: 'write',
  scope: 'finance:write',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, 'finance')
    const actionParams = {
      transactionId: params.transactionId as string,
      categoryId: params.categoryId as string,
      learn: params.learn as boolean | undefined,
    }
    const summary = `거래 ${actionParams.transactionId} 재분류 → 계정과목 ${actionParams.categoryId}`
    const r = await createPendingAction({
      spaceId: ctx.spaceId,
      actionType: 'finance.transaction.reclassify',
      params: actionParams,
      summary,
      source: 'MCP',
      actor: ctx.actor,
      requesterUserId: ctx.requesterUserId,
      requesterSlackUserId: ctx.requesterSlackUserId,
      actorTokenId: ctx.actorTokenId,
      authenticatedUserId: ctx.authenticatedUserId,
      workId: ctx.workId,
      idempotencyKey: idempotencyKeyFor(
        'finance.transaction.reclassify',
        ctx.spaceId,
        actionParams
      ),
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
  scope: 'finance:write',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, 'finance')
    const actionParams = {
      matchKey: params.matchKey as string,
      categoryId: params.categoryId as string,
      matchType: params.matchType as 'EXACT' | 'KEYWORD',
      memo: params.memo as string | undefined,
    }
    const summary = `분류 규칙 생성: "${actionParams.matchKey}" (${actionParams.matchType}) → 계정과목 ${actionParams.categoryId}`
    const r = await createPendingAction({
      spaceId: ctx.spaceId,
      actionType: 'finance.classrule.create',
      params: actionParams,
      summary,
      source: 'MCP',
      actor: ctx.actor,
      requesterUserId: ctx.requesterUserId,
      requesterSlackUserId: ctx.requesterSlackUserId,
      workId: ctx.workId,
      idempotencyKey: idempotencyKeyFor('finance.classrule.create', ctx.spaceId, actionParams),
    })
    return r
  },
}

// ─── seller-hub ────────────────────────────────────────────────────────────────

const sellerhubCreateReorderPlanTool: ToolDefinition = {
  name: 'sellerhub_create_reorder_plan',
  description:
    '상품의 발주 계획(초안)을 생성합니다. 쓰기 권한이 있으면 바로 실행되고 결과 링크를 돌려줍니다. 실행 전에 사용자에게 대상·내용을 확인받으세요. 발주 화면 위저드 기본값과 같은 계산(sellerhub_get_reorder_preview 와 동일 — 로켓그로스 분리·SKU 배분·자체·3PL 입고 위치)으로 승인 시점 데이터 기준 다시 계산됩니다. 수량은 지정할 수 없습니다. 상품 전체를 계획하려면 optionIds 를 넘기지 마세요(넘기면 그 옵션만 계획).',
  inputSchema: {
    productId: z.string(),
    optionIds: z.array(z.string()).optional(),
    memo: z.string().optional(),
  },
  mode: 'write',
  scope: 'sellerhub:write',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, 'seller-hub')
    const actionParams = {
      productId: params.productId as string,
      optionIds: params.optionIds as string[] | undefined,
      memo: params.memo as string | undefined,
    }
    const summary = `발주 계획 생성: 상품 ${actionParams.productId}`
    const r = await createPendingAction({
      spaceId: ctx.spaceId,
      actionType: 'seller-hub.reorder.plan.create',
      params: actionParams,
      summary,
      source: 'MCP',
      actor: ctx.actor,
      requesterUserId: ctx.requesterUserId,
      requesterSlackUserId: ctx.requesterSlackUserId,
      authenticatedUserId: ctx.authenticatedUserId,
      workId: ctx.workId,
      actorTokenId: ctx.actorTokenId,
      // 같은 날 같은 요청만 중복으로 본다 — 다음 주 같은 상품 요청은 새 계획
      idempotencyKey: idempotencyKeyFor('seller-hub.reorder.plan.create', ctx.spaceId, {
        params: actionParams,
        day: getTodayStrKst(),
      }),
    })
    return r
  },
}

const sellerhubProposeKeywordUpdateTool: ToolDefinition = {
  name: 'sellerhub_propose_keyword_update',
  description:
    '상품(채널상품 또는 단독 리스팅) 1개의 키워드 추가·삭제 묶음을 제안합니다. target 은 channelProductId 또는 listingId 중 정확히 하나, add ≤10, remove ≤30, evidence(단어별 {orders, clicks})와 note 는 선택입니다. 상품명은 바꾸지 않습니다. 같은 상품에 승인 대기 제안이 있으면 거부됩니다. 쓰기 권한이 있으면 바로 실행되고 결과 링크를 돌려줍니다. 실행 전에 사용자에게 대상·내용을 확인받으세요. 변경 이력이 자동 기록됩니다.',
  inputSchema: {
    target: z.object({ channelProductId: z.string().optional(), listingId: z.string().optional() }),
    add: z.array(z.string()).max(10),
    remove: z.array(z.string()).max(30),
    evidence: z.record(z.string(), z.object({ orders: z.number(), clicks: z.number() })).optional(),
    note: z.string().optional(),
  },
  mode: 'write',
  scope: 'sellerhub:write',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, 'seller-hub')
    const actionParams = {
      target: params.target as { channelProductId?: string; listingId?: string },
      add: params.add as string[],
      remove: params.remove as string[],
      evidence: params.evidence as Record<string, { orders: number; clicks: number }> | undefined,
      note: params.note as string | undefined,
    }
    const name = await readTargetKeywords(ctx.spaceId, actionParams.target ?? {})
    const summary = `키워드 묶음 — ${name?.name ?? '(대상 미확인)'}: ${[
      ...actionParams.add.map((w) => `+${w}`),
      ...actionParams.remove.map((w) => `−${w}`),
    ].join(' ')}`
    return createPendingAction({
      spaceId: ctx.spaceId,
      actionType: 'seller-hub.keywords.update',
      params: actionParams,
      summary,
      source: 'MCP',
      actor: ctx.actor,
      requesterUserId: ctx.requesterUserId,
      requesterSlackUserId: ctx.requesterSlackUserId,
      actorTokenId: ctx.actorTokenId,
      authenticatedUserId: ctx.authenticatedUserId,
      workId: ctx.workId,
      idempotencyKey: idempotencyKeyFor('seller-hub.keywords.update', ctx.spaceId, actionParams),
    })
  },
}

// ─── coupang-ads (Workspace 스코프) ──────────────────────────────────────────────

const adsTriggerAnalysisTool: ToolDefinition = {
  name: 'ads_trigger_analysis',
  description:
    'AI 광고 분석을 실행합니다. 쓰기 권한이 있으면 바로 실행되고 결과 링크를 돌려줍니다. 실행 전에 사용자에게 대상·내용을 확인받으세요. 분석 결과는 완료된 뒤 광고 분석 화면에서 확인합니다.',
  inputSchema: {
    from: z.string(),
    to: z.string(),
    reportType: z
      .enum(['DAILY_REVIEW', 'KEYWORD_AUDIT', 'BUDGET_OPTIMIZATION', 'CAMPAIGN_SCORING'])
      .optional(),
  },
  mode: 'write',
  scope: 'ads:write',
  async execute(ctx, params) {
    const workspace = await resolveMcpWorkspace(ctx.spaceId)
    const actionParams = {
      workspaceId: workspace.id,
      from: params.from as string,
      to: params.to as string,
      reportType: params.reportType as string | undefined,
    }
    const summary = `AI 광고 분석 실행: ${actionParams.from}~${actionParams.to} (${actionParams.reportType ?? 'DAILY_REVIEW'})`
    const r = await createPendingAction({
      spaceId: ctx.spaceId,
      actionType: 'coupang-ads.analysis.trigger',
      params: actionParams,
      summary,
      source: 'MCP',
      actor: ctx.actor,
      requesterUserId: ctx.requesterUserId,
      requesterSlackUserId: ctx.requesterSlackUserId,
      actorTokenId: ctx.actorTokenId,
      authenticatedUserId: ctx.authenticatedUserId,
      workId: ctx.workId,
      idempotencyKey: idempotencyKeyFor('coupang-ads.analysis.trigger', ctx.spaceId, actionParams),
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
  scope: 'ads:write',
  async execute(ctx, params) {
    const workspace = await resolveMcpWorkspace(ctx.spaceId)
    const actionParams = {
      taskId: params.taskId as string,
      workspaceId: workspace.id,
    }
    const summary = `광고 실행 태스크 승인: ${actionParams.taskId}`
    const r = await createPendingAction({
      spaceId: ctx.spaceId,
      actionType: 'coupang-ads.execution.approve',
      params: actionParams,
      summary,
      source: 'MCP',
      actor: ctx.actor,
      requesterUserId: ctx.requesterUserId,
      requesterSlackUserId: ctx.requesterSlackUserId,
      workId: ctx.workId,
      idempotencyKey: idempotencyKeyFor('coupang-ads.execution.approve', ctx.spaceId, actionParams),
    })
    return r
  },
}

export const writeTools: ToolDefinition[] = [
  financeClassifyTransactionsTool,
  financeCreateClassRuleTool,
  sellerhubCreateReorderPlanTool,
  sellerhubProposeKeywordUpdateTool,
  adsTriggerAnalysisTool,
  adsApproveExecutionTaskTool,
]
