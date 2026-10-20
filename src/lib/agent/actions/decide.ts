/**
 * 웹 승인 결정 1건 — 단건 PATCH와 일괄(bulk) 라우트가 같이 쓴다(규칙이 갈라지지 않도록).
 *
 * 보안: 호출자의 "현재" Space가 아니라 **액션의 spaceId에 대한 멤버십**으로 확인한다(cross-space IDOR 차단).
 *   역할(지출 한도 초과 → OWNER)·구독 차단은 approveAndExecute/rejectAction 내부 정책이 판단한다.
 */
import { prisma } from '@/lib/prisma'
import { approveAndExecute, rejectAction } from '@/lib/agent/actions/execute'
import { syncSlackDecision } from '@/lib/slack/sync-decision'
import { maskParams } from '@/lib/agent/audit'
import type { DecisionOutcome } from '@/lib/agent/actions/execute'

export type DecideResult =
  | { status: 404 | 403; error: string; outcome?: undefined }
  // outcome은 maskParams를 거친 값(비밀 값 가림).
  | { status: number; outcome: DecisionOutcome; error?: undefined }

export async function decideAction(
  userId: string,
  actionId: string,
  decision: 'approve' | 'reject'
): Promise<DecideResult> {
  const action = await prisma.agentPendingAction.findUnique({
    where: { id: actionId },
    select: { id: true, spaceId: true, actionType: true },
  })
  if (!action) return { status: 404, error: '액션을 찾을 수 없습니다' }

  // 액션 소속 space에서의 호출자 멤버십 — cross-space 승인 차단.
  const member = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: action.spaceId, userId } },
    select: { role: true },
  })
  if (!member?.role) return { status: 403, error: '권한이 없습니다' }

  const outcome =
    decision === 'approve'
      ? await approveAndExecute(actionId, userId)
      : await rejectAction(actionId, userId)
  // 응답의 실행 결과·오류 메시지도 GET과 같은 규칙으로 비밀 값을 가린다(maskParams가 문자열에 maskSecrets 적용).
  const masked = maskParams(outcome) as DecisionOutcome

  // 역할 부족(지출 제안은 OWNER) — 상태 변화 없음.
  if (outcome.status === 'FORBIDDEN') return { status: 403, outcome: masked }
  // 구독 만료로 차단 — 아무 상태도 바뀌지 않았으므로 Slack 동기화도 하지 않는다.
  if (outcome.status === 'BLOCKED') return { status: 402, outcome: masked }

  // 결정 후 Slack 원본 메시지를 최종 상태로 동기화(sync 내부가 무해 — no-op·실패 흡수).
  await syncSlackDecision(actionId)

  // CONFLICT(이미 처리) 또는 EXPIRED(승인 유효기간 만료)면 409, 그 외는 결과 그대로 200.
  const status = outcome.status === 'CONFLICT' || outcome.status === 'EXPIRED' ? 409 : 200
  return { status, outcome: masked }
}
