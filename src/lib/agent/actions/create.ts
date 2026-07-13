import { prisma } from '@/lib/prisma'
import { buildAppUrl } from '@/lib/domain'
import { getActionDefinition } from './registry'
import type { PendingActionDraft, PendingActionResult } from './types'

// 승인 만료 기본 72시간.
const DEFAULT_TTL_MS = 72 * 60 * 60 * 1000

function toResult(action: { id: string; expiresAt: Date }): PendingActionResult {
  return {
    status: 'pending_approval',
    actionId: action.id,
    approvalUrl: buildAppUrl(`/approvals?action=${action.id}`),
    expiresAt: action.expiresAt.toISOString(),
  }
}

/**
 * 승인 대기 액션을 생성한다. write tool·에이전트가 이 함수만 호출하고 즉시 mutate하지 않는다.
 *
 *  1. actionType 유효성·paramsSchema 검증 (실패 시 throw).
 *  2. idempotencyKey가 있으면 기존 액션을 먼저 조회 → 있으면 그대로 반환(멱등).
 *  3. snapshot(선택) → INSERT(PENDING, expiresAt=now+72h).
 *  4. 생성 중 idempotencyKey 경합(P2002)이면 승자 액션을 재조회해 반환.
 */
export async function createPendingAction(draft: PendingActionDraft): Promise<PendingActionResult> {
  const def = getActionDefinition(draft.actionType)
  if (!def) throw new Error(`알 수 없는 액션 유형: ${draft.actionType}`)

  const parsed = def.paramsSchema.safeParse(draft.params)
  if (!parsed.success) {
    throw new Error(
      `액션 파라미터가 올바르지 않습니다: ${parsed.error.issues.map((i) => i.message).join(', ')}`
    )
  }
  const params = parsed.data

  // 멱등: 동일 키 기존 액션이 있으면 새로 만들지 않고 그대로 반환.
  if (draft.idempotencyKey) {
    const existing = await prisma.agentPendingAction.findUnique({
      where: { idempotencyKey: draft.idempotencyKey },
      select: { id: true, expiresAt: true },
    })
    if (existing) return toResult(existing)
  }

  const ctx = { spaceId: draft.spaceId, requestedBy: draft.requestedBy }
  let beforeState: unknown = undefined
  if (def.snapshot) {
    try {
      beforeState = await def.snapshot(ctx, params)
    } catch {
      // 스냅샷 실패는 액션 생성을 막지 않는다(감사 정보 손실만).
      beforeState = null
    }
  }

  const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS)

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
        requestedBy: draft.requestedBy,
        expiresAt,
        idempotencyKey: draft.idempotencyKey ?? null,
      },
      select: { id: true, expiresAt: true },
    })
    return toResult(action)
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
        select: { id: true, expiresAt: true },
      })
      if (winner) return toResult(winner)
    }
    throw err
  }
}
