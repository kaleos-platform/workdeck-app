import type { z } from 'zod'
import type { SpaceMemberRole } from '@/lib/api-helpers'

// 승인 큐 액션의 실행 컨텍스트 — 항상 spaceId 스코프.
export interface ActionExecContext {
  spaceId: string
  // 요청자 User.id (감사·규칙 학습 등에 필요할 수 있음)
  requestedBy: string
  // AgentPendingAction.id — execute 시점에만 채워진다(validateCreate/snapshot 시점엔 아직 없음).
  // CoupangWriteJob.actionId 같은 멱등 FK에 쓴다.
  actionId?: string
}

/**
 * 액션 정의 — 승인 큐에 쌓이는 write 액션의 단일 소스.
 * MCP write tool·워크덱 에이전트가 createPendingAction으로 큐에 넣고,
 * 승인 시 execute가 실제 DB 변경을 수행한다.
 *
 * 규약:
 *  - execute는 승인(APPROVED 전이 성공) 이후에만 호출된다. 절대 즉시 mutate 금지.
 *  - snapshot은 실행 전 상태를 캡처(diff·감사용). 실패해도 액션 생성은 진행.
 *  - execute는 순수 도메인 로직 재사용(route 핸들러가 아니라 추출된 spaceId-우선 함수).
 */
export interface ActionDefinition<TParams = Record<string, unknown>> {
  actionType: string // "{deck}.{대상}.{동사}", 예 "finance.transaction.reclassify"
  deckKey: string // "finance" | "seller-hub" | "coupang-ads"
  title: string // 한국어 — 승인 UI 제목
  paramsSchema: z.ZodType<TParams>
  requiredRole: SpaceMemberRole // 승인에 필요한 최소 역할 (기본 ADMIN)
  /** 승인 유효기간(시간). 미지정 시 기본 72. 실판매가를 바꾸는 액션은 짧게 둔다. */
  expiryHours?: number
  // 생성 시점 가드 (선택) — throw하면 액션 생성 자체가 거부된다.
  // snapshot과 달리 실패해도 생성이 진행되지 않는다 — 사람이 실행 불가능한
  // 액션(예: 연동 안 된 space)을 승인 큐에서 보는 사고를 막는다.
  validateCreate?: (ctx: ActionExecContext, params: TParams) => Promise<void>
  // 실행 전 상태 스냅샷 (선택) — beforeState로 저장된다.
  snapshot?: (ctx: ActionExecContext, params: TParams) => Promise<unknown>
  // 승인 후 실제 변경 수행 — 반환값은 result로 저장된다.
  execute: (ctx: ActionExecContext, params: TParams) => Promise<unknown>
}

// createPendingAction 입력.
export interface PendingActionDraft {
  spaceId: string
  actionType: string
  params: unknown // paramsSchema로 검증됨
  summary: string
  source: 'MCP' | 'WORKDECK_AGENT' | 'WEB' | 'SYSTEM'
  requestedBy: string
  idempotencyKey?: string
}

// createPendingAction 반환 — MCP write tool이 그대로 노출한다.
export interface PendingActionResult {
  status: 'pending_approval'
  actionId: string
  approvalUrl: string
  expiresAt: string // ISO
}
