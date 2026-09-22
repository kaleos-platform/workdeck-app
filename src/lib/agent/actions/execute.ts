import { prisma } from '@/lib/prisma'
import { getActionDefinition } from './registry'

// 결정 결과 — API·Slack 핸들러가 그대로 응답에 쓴다.
export type DecisionOutcome =
  | { ok: true; status: 'EXECUTED'; result: unknown }
  | { ok: false; status: 'FAILED'; error: string }
  | { ok: false; status: 'REJECTED' }
  // 이미 다른 요청이 처리했거나 대기 상태가 아님 — 경합 패자/무효 요청.
  | { ok: false; status: 'CONFLICT'; message: string }
  // PENDING이지만 expiresAt이 지남 — EXPIRED 전환(lazy expire·cron) 전이라도 승인 차단.
  | { ok: false; status: 'EXPIRED'; message: string }

/**
 * 액션 승인 + 즉시 실행. 동시 승인 경합을 조건부 update로 차단한다.
 *
 * 핵심 불변식: 실행 게이트는 `updateMany({ where:{ id, status:PENDING } })`가
 * **count===1**을 반환하는 것. execute는 반드시 그 성공 이후에만 호출된다
 * (findUnique로 상태를 읽고 판단하는 TOCTOU 금지). 두 요청이 동시에 승인하면
 * DB의 WHERE status='PENDING'이 하나만 통과시키므로 execute는 정확히 1회 실행된다.
 *
 * 상태 전이: PENDING --(승인 게이트 count=1)--> APPROVED
 *   --(execute 성공)--> EXECUTED(+result) / --(execute throw)--> FAILED(+error).
 * execute가 throw해도 APPROVED에 머물지 않는다.
 */
export async function approveAndExecute(
  actionId: string,
  deciderId: string
): Promise<DecisionOutcome> {
  const now = new Date()

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
    select: { actionType: true, spaceId: true, requestedBy: true, payload: true },
  })
  if (!action) {
    return { ok: false, status: 'CONFLICT', message: '액션을 찾을 수 없습니다' }
  }

  const def = getActionDefinition(action.actionType)
  if (!def) {
    const error = `알 수 없는 액션 유형: ${action.actionType}`
    await prisma.agentPendingAction.update({
      where: { id: actionId },
      data: { status: 'FAILED', error, executedAt: new Date() },
    })
    return { ok: false, status: 'FAILED', error }
  }

  // 실행 — 성공 EXECUTED, 실패 FAILED. APPROVED에 머무르지 않는다.
  try {
    const parsed = def.paramsSchema.parse(action.payload)
    const result = await def.execute(
      { spaceId: action.spaceId, requestedBy: action.requestedBy, actionId },
      parsed
    )
    await prisma.agentPendingAction.update({
      where: { id: actionId },
      data: { status: 'EXECUTED', executedAt: new Date(), result: (result ?? null) as object },
    })
    return { ok: true, status: 'EXECUTED', result }
  } catch (err) {
    const error = err instanceof Error ? err.message : '실행 중 알 수 없는 오류'
    await prisma.agentPendingAction.update({
      where: { id: actionId },
      data: { status: 'FAILED', error, executedAt: new Date() },
    })
    return { ok: false, status: 'FAILED', error }
  }
}

/**
 * 액션 거부. 승인과 동일한 조건부 전이로 경합을 차단한다.
 */
export async function rejectAction(actionId: string, deciderId: string): Promise<DecisionOutcome> {
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
