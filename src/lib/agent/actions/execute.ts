import { prisma } from '@/lib/prisma'
import { assertDeckWritable } from '@/lib/billing/entitlement'
import { finishToolAudit, maskSecrets, startToolAudit } from '@/lib/agent/audit'
import { isPrismaError } from '@/lib/agent/tools/run-tool'
import type { ActorType } from '@/lib/agent/identity/principal'
import type { ActionExecContext } from './types'
import { getActionDefinition } from './registry'
import { deciderDenial } from './decision-policy'

// 결정 결과 — API·Slack 핸들러가 그대로 응답에 쓴다.
export type DecisionOutcome =
  | { ok: true; status: 'EXECUTED'; result: unknown }
  | { ok: false; status: 'FAILED'; error: string }
  | { ok: false; status: 'REJECTED' }
  // 이미 다른 요청이 처리했거나 대기 상태가 아님 — 경합 패자/무효 요청.
  | { ok: false; status: 'CONFLICT'; message: string }
  // 구독 만료(LOCKED) Space — 결정하지 않고 PENDING 그대로 둔다.
  | { ok: false; status: 'BLOCKED'; message: string }
  // PENDING이지만 expiresAt이 지남 — EXPIRED 전환(lazy expire·cron) 전이라도 승인 차단.
  | { ok: false; status: 'EXPIRED'; message: string }
  // 결정자가 Space 구성원이 아니거나 역할 부족(지출 제안은 OWNER) — 상태를 바꾸지 않는다.
  | { ok: false; status: 'FORBIDDEN'; message: string }

/**
 * 액션 승인 + 즉시 실행. 동시 승인 경합을 조건부 update로 차단한다.
 *
 * 핵심 불변식: 실행 게이트는 `updateMany({ where:{ id, status:PENDING } })`가
 * **count===1**을 반환하는 것. execute는 반드시 그 성공 이후에만 호출된다
 * (findUnique로 상태를 읽고 판단하는 TOCTOU 금지). 두 요청이 동시에 승인하면
 * DB의 WHERE status='PENDING'이 하나만 통과시키므로 execute는 정확히 1회 실행된다.
 *
 * 상태 전이: PENDING --(승인 게이트 count=1)--> APPROVED
 *   --(실행 감사 행 생성 실패)--> FAILED(실행하지 않음)
 *   --(execute 성공)--> EXECUTED(+result) / --(execute throw)--> FAILED(+error).
 * execute가 throw해도 APPROVED에 머물지 않는다. 실행 감사(tool: 'action:<actionType>')는 여기서만 쓴다.
 */
export const ACTION_INTERNAL_ERROR = '액션 실행 중 내부 오류가 발생했습니다'

/**
 * 실행 오류 문구 — AgentPendingAction.error(승인 UI·Slack 승인 채널에 게시)와 감사 행에 같이 쓴다.
 * Prisma 오류는 메시지에 쿼리·인자가 섞이므로 일반 문구(로그·감사에는 종류·코드만).
 * 그 밖(도메인·외부 API 오류)은 승인자가 맥락을 보도록 비밀 마스킹 후 1000자로 남긴다.
 */
function executionError(err: unknown): string {
  if (isPrismaError(err)) {
    const code = (err as { code?: unknown }).code
    console.error(
      '[agent] 액션 실행 중 DB 오류',
      `${(err as Error).name}${typeof code === 'string' ? ` ${code}` : ''}`
    )
    return ACTION_INTERNAL_ERROR
  }
  const raw = err instanceof Error ? err.message : '실행 중 알 수 없는 오류'
  return maskSecrets(raw).slice(0, 1000)
}

export async function approveAndExecute(
  actionId: string,
  deciderId: string
): Promise<DecisionOutcome> {
  const now = new Date()

  // 승인 게이트 **이전**의 entitlement 검사 — MCP·Slack·웹 승인이 모두 이 함수를 지난다.
  // 여기서만 막으면 UI 가드가 없는 외부 토큰 경로까지 한 번에 닫힌다.
  // 상태를 바꾸지 않고 PENDING으로 남기므로 재구독 후 그대로 승인할 수 있고,
  // 승인 게이트의 "updateMany count===1" 불변식도 건드리지 않는다.
  const pre = await prisma.agentPendingAction.findUnique({
    where: { id: actionId },
    select: { status: true, spaceId: true, deckKey: true, actionType: true, payload: true },
  })
  if (pre?.status === 'PENDING') {
    // 결정자 역할 검사 — Slack·웹·MCP 승인 경로가 모두 이 함수를 지나므로 여기서 한 번에 닫는다.
    // 검사와 아래 updateMany 게이트 사이에 짧은 창이 있다: 그 사이 결정자 역할 강등이나
    // approvalLimitKrw·payload 변경은 반영되지 않는다(payload 는 생성 후 불변, 역할 변경은 드묾).
    const denial = await deciderDenial(pre, deciderId, 'approve')
    if (denial) return { ok: false, status: 'FORBIDDEN', message: denial }
    const blocked = await assertDeckWritable(pre.spaceId, pre.deckKey)
    if (blocked) return { ok: false, status: 'BLOCKED', message: blocked }
  }

  // 게이트: PENDING 이고 아직 만료되지 않은 경우에만 APPROVED 로 전이.
  // expiresAt 을 보지 않으면 EXPIRED 전환(목록 lazy expire·하루 1회 cron) 전의
  // 만료 액션이 그대로 승인·실행된다 — 가격 쓰기의 6시간 만료가 무효가 된다.
  const gate = await prisma.agentPendingAction.updateMany({
    where: { id: actionId, status: 'PENDING', expiresAt: { gt: now } },
    data: { status: 'APPROVED', decidedBy: deciderId, decidedAt: now },
  })
  if (gate.count !== 1) {
    // count=0 의 사유를 나눠야 사용자가 영문을 안다.
    const current = await prisma.agentPendingAction.findUnique({
      where: { id: actionId },
      select: { status: true, expiresAt: true },
    })
    if (current?.status === 'PENDING' && current.expiresAt <= now) {
      return {
        ok: false,
        status: 'EXPIRED',
        message: '승인 유효기간이 지난 액션입니다. 다시 요청해 주세요',
      }
    }
    return {
      ok: false,
      status: 'CONFLICT',
      message: '이미 처리되었거나 대기 상태가 아닌 액션입니다',
    }
  }

  // 게이트 통과 후 payload/actionType 로드 (승자만 도달).
  const action = await prisma.agentPendingAction.findUnique({
    where: { id: actionId },
    select: {
      actionType: true,
      spaceId: true,
      actorType: true,
      actorId: true,
      requesterUserId: true,
      workId: true,
      payload: true,
    },
  })
  if (!action) {
    return { ok: false, status: 'CONFLICT', message: '액션을 찾을 수 없습니다' }
  }

  const fail = async (error: string): Promise<DecisionOutcome> => {
    await prisma.agentPendingAction.update({
      where: { id: actionId },
      data: { status: 'FAILED', error, executedAt: new Date() },
    })
    return { ok: false, status: 'FAILED', error }
  }

  const def = getActionDefinition(action.actionType)
  if (!def) return fail(`알 수 없는 액션 유형: ${action.actionType}`)

  // 실행 컨텍스트: 제안한 원래 행위자·요청자·workId와 승인자를 따로 싣는다.
  // workId가 없는 레거시 액션은 act_<id>로 묶는다(같은 액션의 감사 행끼리는 이어진다).
  const ctx: ActionExecContext = {
    spaceId: action.spaceId,
    actor: { type: action.actorType as ActorType, id: action.actorId },
    requesterUserId: action.requesterUserId,
    workId: action.workId ?? `act_${actionId}`,
    deciderId,
    actionId,
    decryptedCredentialIds: [],
  }

  // 실행 의도를 먼저 남긴다. 못 남기면 실행하지 않는다(외부 쓰기가 감사 없이 일어나지 않게).
  let auditId: string
  try {
    auditId = await startToolAudit({
      spaceId: ctx.spaceId,
      workId: ctx.workId,
      actor: ctx.actor,
      requesterUserId: ctx.requesterUserId,
      tool: `action:${action.actionType}`,
      args: (action.payload ?? {}) as Record<string, unknown>,
      actionId,
      deciderUserId: deciderId,
    })
  } catch (err) {
    return fail(err instanceof Error ? err.message : '감사 기록 실패')
  }

  // 실행 — 성공 EXECUTED, 실패 FAILED. try는 execute만 감싼다:
  // 결과 기록(감사 갱신·상태 갱신)이 실패해도 FAILED로 바꾸거나 다시 실행하지 않는다.
  // (EXECUTED 갱신이 실패하면 예외가 호출자에게 올라가고 상태는 APPROVED로 남는다 — 게이트가 PENDING만
  // 통과시키므로 재실행되지 않는다. 감사 행에는 ok가 남는다.)
  const started = Date.now()
  let result: unknown
  try {
    const parsed = def.paramsSchema.parse(action.payload)
    result = await def.execute(ctx, parsed)
  } catch (err) {
    const error = executionError(err)
    await finishToolAudit(auditId, {
      outcome: 'error',
      error,
      durationMs: Date.now() - started,
      decryptedCredentialIds: ctx.decryptedCredentialIds,
    })
    return fail(error)
  }
  await finishToolAudit(auditId, {
    outcome: 'ok',
    durationMs: Date.now() - started,
    decryptedCredentialIds: ctx.decryptedCredentialIds,
  })
  try {
    await prisma.agentPendingAction.update({
      where: { id: actionId },
      data: { status: 'EXECUTED', executedAt: new Date(), result: (result ?? null) as object },
    })
  } catch (err) {
    console.error('[agent] EXECUTED 기록 실패 — APPROVED로 남음', actionId)
    throw err
  }
  return { ok: true, status: 'EXECUTED', result }
}

/**
 * 액션 거부. 승인과 동일한 조건부 전이로 경합을 차단한다.
 */
export async function rejectAction(actionId: string, deciderId: string): Promise<DecisionOutcome> {
  const pre = await prisma.agentPendingAction.findUnique({
    where: { id: actionId },
    select: { status: true, spaceId: true, actionType: true, payload: true },
  })
  if (pre?.status === 'PENDING') {
    const denial = await deciderDenial(pre, deciderId, 'reject')
    if (denial) return { ok: false, status: 'FORBIDDEN', message: denial }
  }
  const gate = await prisma.agentPendingAction.updateMany({
    where: { id: actionId, status: 'PENDING' },
    data: { status: 'REJECTED', decidedBy: deciderId, decidedAt: new Date() },
  })
  if (gate.count !== 1) {
    return {
      ok: false,
      status: 'CONFLICT',
      message: '이미 처리되었거나 대기 상태가 아닌 액션입니다',
    }
  }
  return { ok: false, status: 'REJECTED' }
}

/**
 * 만료된 PENDING 액션을 EXPIRED로 전환한다(lazy expire·cron 공용).
 * 조건부 updateMany라 승인/거부 경합과 안전하게 공존한다.
 * @returns 만료 처리된 건수
 */
export async function expirePendingActions(): Promise<number> {
  const res = await prisma.agentPendingAction.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  })
  return res.count
}
