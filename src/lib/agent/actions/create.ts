import { prisma } from '@/lib/prisma'
import { ToolUserError } from '@/lib/agent/tools/errors'
import { assertDeckWritable } from '@/lib/billing/entitlement'
import { buildAppUrl } from '@/lib/domain'
import { notifyPendingAction } from '@/lib/slack/notify-pending-action'
import { getActionDefinition } from './registry'
import { approveAndExecute } from './execute'
import type {
  ActionDefinition,
  ActionExecContext,
  PendingActionDraft,
  PendingActionResult,
} from './types'

// 승인 만료 기본 72시간.
const DEFAULT_TTL_HOURS = 72

// 저장된 액션의 실제 상태 → 응답 status. 상태가 없거나 PENDING 이면 승인 대기.
const STATUS_MAP: Record<string, PendingActionResult['status']> = {
  APPROVED: 'executing',
  EXECUTED: 'executed',
  FAILED: 'failed',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
}

interface StoredAction {
  id: string
  spaceId: string
  expiresAt: Date
  status?: string
  actionType?: string
  result?: unknown
  error?: string | null
}

function toResult(action: StoredAction): PendingActionResult {
  const base: PendingActionResult = {
    status: STATUS_MAP[action.status ?? ''] ?? 'pending_approval',
    actionId: action.id,
    // 두 Space 이상 구성원도 선택 화면 없이 바로 열리도록 Space를 링크에 싣는다.
    approvalUrl: buildAppUrl(`/approvals?spaceId=${action.spaceId}&action=${action.id}`),
    expiresAt: action.expiresAt.toISOString(),
  }
  if (base.status === 'executed') {
    const def = action.actionType ? getActionDefinition(action.actionType) : undefined
    base.result = action.result ?? null
    base.resultUrl = def?.resultUrl?.(action.result, { spaceId: action.spaceId }) ?? null
  }
  if (base.status === 'failed') base.error = action.error ?? undefined
  return base
}

// idempotencyKey 는 전역 unique 라 다른 Space 의 액션과 부딪힐 수 있다 — 그 액션은 돌려주지 않고 거부한다.
function toResultInSpace(action: StoredAction, spaceId: string): PendingActionResult {
  if (action.spaceId !== spaceId) {
    throw new ToolUserError('이미 다른 공간에서 사용한 idempotencyKey 입니다')
  }
  return toResult(action)
}

/**
 * 승인 대기 액션을 생성한다. write tool·에이전트가 이 함수만 호출하고 즉시 mutate하지 않는다.
 *
 *  1. actionType 유효성·paramsSchema 검증 (실패 시 throw).
 *  2. idempotencyKey가 있으면 기존 액션을 먼저 조회 → 있으면 그대로 반환(멱등).
 *  3. validateCreate(선택, 실패 시 throw로 생성 거부) → snapshot(선택, 실패해도 진행)
 *     → INSERT(PENDING, expiresAt=now+expiryHours(기본 72h)).
 *  4. 생성 중 idempotencyKey 경합(P2002)이면 승자 액션을 재조회해 반환.
 */
// 같은 멱등 키로 새 제안을 허용하는 종료 상태. 실행된 적이 없는 상태만 기본 허용한다.
// FAILED 는 외부 API 가 이미 실행됐을 수 있어(응답 타임아웃 등) 액션이 retryableAfterFailure 로
// "실패하면 아무것도 남지 않는다"고 선언한 경우에만 허용한다.
const NEVER_EXECUTED: string[] = ['REJECTED', 'EXPIRED']

const AUTO_SKIPPED = '초안 자동 실행 조건이 맞지 않아 승인 대기로 등록했습니다'

/**
 * 「초안 자동 실행」 — 대상 액션·토큰 있는 에이전트·스위치 켜짐일 때만 켠 관리자 이름으로 승인+실행한다.
 * result 가 있으면 그대로 응답(알림 없음), 없으면 승인 대기로 남은 것(skipped 는 자동 실행을 시도했다는 뜻).
 */
async function tryAutoExecute(
  def: ActionDefinition,
  draft: PendingActionDraft,
  action: { id: string; spaceId: string; expiresAt: Date }
): Promise<{ result?: PendingActionResult; skipped?: string }> {
  if (!def.autoExecutable || draft.actor.type !== 'agent' || !draft.actorTokenId) return {}
  const agent = await prisma.spaceAgent.findFirst({
    where: { id: draft.actor.id, spaceId: draft.spaceId },
    select: { autoExecuteDrafts: true, autoExecuteEnabledById: true },
  })
  if (!agent?.autoExecuteDrafts || !agent.autoExecuteEnabledById) return {}

  // 실패·경합 뒤에는 DB 의 실제 상태를 다시 읽어 응답한다.
  const reread = async (): Promise<StoredAction> => {
    const cur = await prisma.agentPendingAction.findUnique({
      where: { id: action.id },
      select: {
        id: true,
        spaceId: true,
        expiresAt: true,
        status: true,
        actionType: true,
        result: true,
        error: true,
      },
    })
    return cur ?? { ...action }
  }
  let outcome
  try {
    outcome = await approveAndExecute(action.id, agent.autoExecuteEnabledById, {
      autoGate: { agentId: draft.actor.id, tokenId: draft.actorTokenId },
    })
  } catch (err) {
    console.error(
      '[agent] 초안 자동 실행 중 오류',
      action.id,
      err instanceof Error ? err.name : err
    )
    outcome = { ok: false as const, status: 'CONFLICT' as const, message: '' }
  }
  if (outcome.ok) {
    return {
      result: {
        ...toResult({
          ...action,
          status: 'EXECUTED',
          actionType: draft.actionType,
          result: outcome.result,
        }),
      },
    }
  }
  switch (outcome.status) {
    case 'FAILED':
      return { result: { ...toResult({ ...action, status: 'FAILED' }), error: outcome.error } }
    case 'EXPIRED':
      return { result: toResult({ ...action, status: 'EXPIRED' }) }
    case 'CONFLICT': {
      const cur = await reread()
      return cur.status && cur.status !== 'PENDING'
        ? { result: toResult(cur) }
        : { skipped: AUTO_SKIPPED }
    }
    default:
      // FORBIDDEN·BLOCKED(·REJECTED 불가) — 액션은 PENDING 그대로.
      return { skipped: 'message' in outcome ? outcome.message : AUTO_SKIPPED }
  }
}

export async function createPendingAction(draft: PendingActionDraft): Promise<PendingActionResult> {
  const def = getActionDefinition(draft.actionType)
  if (!def) throw new ToolUserError(`알 수 없는 액션 유형: ${draft.actionType}`)

  const parsed = def.paramsSchema.safeParse(draft.params)
  if (!parsed.success) {
    throw new ToolUserError(
      `액션 파라미터가 올바르지 않습니다: ${parsed.error.issues.map((i) => i.message).join(', ')}`
    )
  }
  const params = parsed.data

  // 구독 만료 Space는 큐잉 자체를 막는다. 실행 경로(approveAndExecute)가 보안 경계이고
  // 여기는 UX — 승인해도 실행되지 않을 액션을 72시간 남기거나 Slack 알림을 쏘지 않기 위함.
  const blocked = await assertDeckWritable(draft.spaceId, def.deckKey)
  if (blocked) throw new ToolUserError(blocked)

  // 멱등: 동일 키 기존 액션이 있으면 새로 만들지 않고 그대로 반환.
  // 단 실패·거절·만료로 끝난 액션은 다시 실행될 수 없으므로 키를 풀고 새로 만든다
  // (그대로 돌려주면 같은 내용의 재요청이 영원히 막힌다). 실행 완료는 중복 실행 방지를 위해 그대로 반환.
  if (draft.idempotencyKey) {
    const existing = await prisma.agentPendingAction.findUnique({
      where: { idempotencyKey: draft.idempotencyKey },
      select: {
        id: true,
        spaceId: true,
        expiresAt: true,
        status: true,
        actionType: true,
        result: true,
        error: true,
      },
    })
    if (existing) {
      const ended =
        existing.spaceId === draft.spaceId &&
        (NEVER_EXECUTED.includes(existing.status) ||
          (existing.status === 'FAILED' && def.retryableAfterFailure === true))
      if (!ended) return toResultInSpace(existing, draft.spaceId)
      await prisma.agentPendingAction.updateMany({
        where: { id: existing.id, idempotencyKey: draft.idempotencyKey },
        data: { idempotencyKey: null },
      })
    }
  }

  // validateCreate·snapshot용. 생성 시점이라 deciderId·actionId는 없다.
  const ctx: ActionExecContext = {
    spaceId: draft.spaceId,
    actor: draft.actor,
    requesterUserId: draft.requesterUserId ?? null,
    workId: draft.workId ?? '',
    decryptedCredentialIds: [],
  }

  // 생성 시점 가드 — throw하면 그대로 전파되어 생성이 거부된다(snapshot과 달리 관대하지 않음).
  if (def.validateCreate) {
    await def.validateCreate(ctx, params)
  }

  let beforeState: unknown = undefined
  if (def.snapshot) {
    try {
      beforeState = await def.snapshot(ctx, params)
    } catch {
      // 스냅샷 실패는 액션 생성을 막지 않는다(감사 정보 손실만).
      beforeState = null
    }
  }

  // ?? 로 둔다 — truthy 검사면 expiryHours: 0(즉시 만료)이 조용히 72시간이 된다.
  const expiresAt = new Date(Date.now() + (def.expiryHours ?? DEFAULT_TTL_HOURS) * 60 * 60 * 1000)

  try {
    const action = await prisma.agentPendingAction.create({
      data: {
        spaceId: draft.spaceId,
        deckKey: def.deckKey,
        actionType: draft.actionType,
        payload: params as object,
        summary: draft.summary,
        beforeState: beforeState === undefined ? undefined : (beforeState as object),
        source: draft.source,
        actorType: draft.actor.type,
        actorId: draft.actor.id,
        ...(draft.actorTokenId ? { actorTokenId: draft.actorTokenId } : {}),
        requesterUserId: draft.requesterUserId ?? null,
        requesterSlackUserId: draft.requesterSlackUserId ?? null,
        workId: draft.workId ?? null,
        expiresAt,
        idempotencyKey: draft.idempotencyKey ?? null,
      },
      select: { id: true, spaceId: true, expiresAt: true },
    })
    // 초안 자동 실행 — 승인 대기로 남지 않은 경우 알림 없이 실제 상태로 응답한다.
    const auto = await tryAutoExecute(def, draft, action)
    if (auto.result) return auto.result
    // 신규 생성 경로에서만 Slack 알림(멱등·경합 패자 경로는 제외 — 중복 알림 방지).
    // notify 내부가 전부 try/catch + 타임아웃이라 await해도 액션 생성을 막지 않는다.
    await notifyPendingAction(action.id)
    return {
      ...toResult(action),
      ...(auto.skipped ? { autoExecuteSkipped: auto.skipped } : {}),
    }
  } catch (err) {
    // idempotencyKey 경합 — 다른 요청이 먼저 생성. 승자를 재조회해 반환.
    if (
      draft.idempotencyKey &&
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2002'
    ) {
      const winner = await prisma.agentPendingAction.findUnique({
        where: { idempotencyKey: draft.idempotencyKey },
        select: {
          id: true,
          spaceId: true,
          expiresAt: true,
          status: true,
          actionType: true,
          result: true,
          error: true,
        },
      })
      if (winner) return toResultInSpace(winner, draft.spaceId)
    }
    throw err
  }
}
